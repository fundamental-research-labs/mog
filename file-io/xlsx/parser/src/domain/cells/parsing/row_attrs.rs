/// All attributes extracted from a `<row>` tag in one pass.
#[derive(Default)]
pub(super) struct RowAttrs<'a> {
    pub(super) height: Option<f64>,
    pub(super) height_str: Option<&'a [u8]>,
    pub(super) custom_height: bool,
    pub(super) hidden: Option<bool>,
    pub(super) collapsed: Option<bool>,
    pub(super) thick_top: bool,
    pub(super) thick_bot: bool,
    pub(super) outline_level: Option<u8>,
    pub(super) custom_format: bool,
    pub(super) style: Option<u32>,
    pub(super) dy_descent: Option<f64>,
    pub(super) spans: Option<&'a [u8]>,
    pub(super) ph: bool,
}

/// Parse all row attributes from `tag_bytes` (the slice between `<row` and `>`)
/// in a single forward scan, avoiding repeated sequence scans.
#[inline]
pub(super) fn parse_row_attrs<'a>(tag_bytes: &'a [u8]) -> RowAttrs<'a> {
    let mut attrs = RowAttrs::default();
    let len = tag_bytes.len();
    let mut i = 0;

    while i < len {
        if tag_bytes[i] != b' ' {
            i += 1;
            continue;
        }
        i += 1;
        if i >= len {
            break;
        }

        match tag_bytes[i] {
            b'h' => {
                if i + 4 <= len && &tag_bytes[i..i + 3] == b"ht=" && tag_bytes[i + 3] == b'"' {
                    let vs = i + 4;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.height_str = Some(&tag_bytes[vs..qe]);
                            attrs.height = s.parse::<f64>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                } else if i + 8 <= len
                    && &tag_bytes[i..i + 7] == b"hidden="
                    && tag_bytes[i + 7] == b'"'
                {
                    let vs = i + 8;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.hidden = match &tag_bytes[vs..qe] {
                            b"1" | b"true" => Some(true),
                            b"0" | b"false" => Some(false),
                            _ => None,
                        };
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b'c' => {
                if i + 15 <= len && &tag_bytes[i..i + 14] == b"customHeight=\"" {
                    attrs.custom_height = tag_bytes.get(i + 14) == Some(&b'1');
                    i += 16;
                    continue;
                } else if i + 15 <= len && &tag_bytes[i..i + 14] == b"customFormat=\"" {
                    attrs.custom_format = tag_bytes.get(i + 14) == Some(&b'1');
                    i += 16;
                    continue;
                } else if i + 11 <= len
                    && &tag_bytes[i..i + 10] == b"collapsed="
                    && tag_bytes[i + 10] == b'"'
                {
                    let vs = i + 11;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.collapsed = match &tag_bytes[vs..qe] {
                            b"1" | b"true" => Some(true),
                            b"0" | b"false" => Some(false),
                            _ => None,
                        };
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b't' => {
                if i + 11 <= len && &tag_bytes[i..i + 10] == b"thickTop=\"" {
                    attrs.thick_top = tag_bytes.get(i + 10) == Some(&b'1');
                    i += 12;
                    continue;
                } else if i + 11 <= len && &tag_bytes[i..i + 10] == b"thickBot=\"" {
                    attrs.thick_bot = tag_bytes.get(i + 10) == Some(&b'1');
                    i += 12;
                    continue;
                }
            }
            b'o' => {
                if i + 14 <= len && &tag_bytes[i..i + 14] == b"outlineLevel=\"" {
                    let vs = i + 14;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.outline_level = std::str::from_utf8(&tag_bytes[vs..qe])
                            .ok()
                            .and_then(|s| s.parse::<u8>().ok());
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b'p' => {
                if i + 4 <= len && &tag_bytes[i..i + 4] == b"ph=\"" {
                    attrs.ph = tag_bytes.get(i + 4) == Some(&b'1');
                    i += 6;
                    continue;
                }
            }
            b's' => {
                if i + 3 <= len && tag_bytes[i + 1] == b'=' && tag_bytes[i + 2] == b'"' {
                    let vs = i + 3;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.style = s.parse::<u32>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                } else if i + 7 <= len
                    && &tag_bytes[i..i + 6] == b"spans="
                    && tag_bytes[i + 6] == b'"'
                {
                    let vs = i + 7;
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        attrs.spans = Some(&tag_bytes[vs..qe]);
                        i = qe + 1;
                        continue;
                    }
                }
            }
            b'd' | b'x' => {
                let dy_prefix = if tag_bytes[i] == b'd' {
                    b"dyDescent=\"" as &[u8]
                } else if i + 15 <= len && &tag_bytes[i..i + 15] == b"x14ac:dyDescent" {
                    b"x14ac:dyDescent=\"" as &[u8]
                } else {
                    &[]
                };
                if !dy_prefix.is_empty()
                    && i + dy_prefix.len() <= len
                    && &tag_bytes[i..i + dy_prefix.len()] == dy_prefix
                {
                    let vs = i + dy_prefix.len();
                    if let Some(qe) = find_byte_in(tag_bytes, b'"', vs) {
                        if let Ok(s) = std::str::from_utf8(&tag_bytes[vs..qe]) {
                            attrs.dy_descent = s.parse::<f64>().ok();
                        }
                        i = qe + 1;
                        continue;
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }

    if !attrs.custom_format {
        attrs.style = None;
    }

    attrs
}

/// Find a byte in a slice starting from `start`. Returns offset within the slice.
#[inline(always)]
fn find_byte_in(bytes: &[u8], needle: u8, start: usize) -> Option<usize> {
    memchr::memchr(needle, &bytes[start..]).map(|p| p + start)
}
