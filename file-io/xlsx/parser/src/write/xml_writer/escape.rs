use std::io::Write;

#[inline]
pub(super) fn append_escaped_text(buffer: &mut Vec<u8>, text: &str) {
    for byte in text.bytes() {
        match byte {
            b'&' => buffer.extend_from_slice(b"&amp;"),
            b'<' => buffer.extend_from_slice(b"&lt;"),
            b'>' => buffer.extend_from_slice(b"&gt;"),
            _ => buffer.push(byte),
        }
    }
}

#[inline]
pub(super) fn append_escaped_attr(buffer: &mut Vec<u8>, value: &str) {
    for byte in value.bytes() {
        match byte {
            b'&' => buffer.extend_from_slice(b"&amp;"),
            b'<' => buffer.extend_from_slice(b"&lt;"),
            b'>' => buffer.extend_from_slice(b"&gt;"),
            b'"' => buffer.extend_from_slice(b"&quot;"),
            b'\'' => buffer.extend_from_slice(b"&apos;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                buffer.extend_from_slice(b"&#");
                write!(buffer, "{}", byte).ok();
                buffer.push(b';');
            }
            _ => buffer.push(byte),
        }
    }
}

#[inline]
pub(super) fn normalize_cdata(content: &str) -> String {
    content.replace("]]>", "]]]]><![CDATA[>")
}

#[inline]
pub(super) fn normalize_comment(content: &str) -> String {
    content.replace("--", "- -")
}
