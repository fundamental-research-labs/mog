use crate::infra::scanner::{extract_quoted_value, find_attr_simd};

#[inline]
pub(super) fn checked_xml_text(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .expect("relationship/workbook XML was validated as UTF-8 at the archive boundary")
        .to_owned()
}

/// Decode common XML entities in a string.
/// Handles: &amp; &lt; &gt; &quot; &apos;
pub(super) fn decode_xml_entities(bytes: &[u8]) -> String {
    let s = std::str::from_utf8(bytes)
        .expect("relationship/workbook XML was validated as UTF-8 at the archive boundary");

    if !s.contains('&') {
        return s.to_owned();
    }

    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Extract attribute value within a byte slice.
pub(super) fn extract_attr_value_in_range<'a>(bytes: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(bytes, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(bytes, value_start)?;
    Some(&bytes[start..end])
}

/// Simple closing tag finder that doesn't use the full scanner.
pub(super) fn find_closing_tag_simple(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;

    while pos + 2 + tag.len() < bytes.len() {
        if let Some(lt_offset) = memchr::memchr(b'<', &bytes[pos..]) {
            let lt_pos = pos + lt_offset;

            if lt_pos + 1 < bytes.len() && bytes[lt_pos + 1] == b'/' {
                let tag_start = lt_pos + 2;
                if tag_start + tag.len() <= bytes.len()
                    && &bytes[tag_start..tag_start + tag.len()] == tag
                {
                    let after_tag = tag_start + tag.len();
                    if after_tag < bytes.len()
                        && matches!(bytes[after_tag], b'>' | b' ' | b'\t' | b'\n' | b'\r')
                    {
                        return Some(lt_pos);
                    }
                }
            }
            pos = lt_pos + 1;
        } else {
            break;
        }
    }

    None
}

/// Find the end of an XML element, handling double-quoted attribute values.
pub(super) fn find_element_end_simple(bytes: &[u8], start: usize) -> Option<usize> {
    let mut pos = start;
    let mut in_quotes = false;

    while pos < bytes.len() {
        let b = bytes[pos];

        if b == b'"' {
            in_quotes = !in_quotes;
        } else if b == b'>' && !in_quotes {
            return Some(pos);
        }

        pos += 1;
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::workbook::types::SheetInfo;

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"Hello"), "Hello");
        assert_eq!(decode_xml_entities(b"A &amp; B"), "A & B");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&quot;quoted&quot;"), "\"quoted\"");
        assert_eq!(decode_xml_entities(b"it&apos;s"), "it's");
        assert_eq!(decode_xml_entities(b"&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
        assert_eq!(decode_xml_entities(b"&#65;&unknown;"), "&#65;&unknown;");
    }

    #[test]
    fn test_extract_attr_value_in_range() {
        let element = b"<sheet name=\"Sheet1\" sheetId=\"1\"/>";

        let name = extract_attr_value_in_range(element, b"name=\"");
        assert_eq!(name, Some(&b"Sheet1"[..]));

        let sheet_id = extract_attr_value_in_range(element, b"sheetId=\"");
        assert_eq!(sheet_id, Some(&b"1"[..]));

        let missing = extract_attr_value_in_range(element, b"missing=\"");
        assert_eq!(missing, None);
    }

    #[test]
    fn test_find_closing_tag_simple() {
        let xml = b"<sheets><sheet/></sheets>";
        let pos = find_closing_tag_simple(xml, b"sheets", 0);
        assert_eq!(pos, Some(16));
    }

    #[test]
    fn test_find_element_end_simple() {
        let xml = b"<sheet name=\"Test\" sheetId=\"1\"/>";
        let pos = find_element_end_simple(xml, 0);
        assert_eq!(pos, Some(31));

        let xml2 = b"<sheet name=\"A>B\" sheetId=\"1\"/>";
        let pos2 = find_element_end_simple(xml2, 0);
        assert_eq!(pos2, Some(30));
    }

    #[test]
    fn test_sheet_info_new() {
        let info = SheetInfo::new("Test".to_string(), 42, "rId5".to_string());
        assert_eq!(info.name, "Test");
        assert_eq!(info.sheet_id, 42);
        assert_eq!(info.r_id, "rId5");
    }
}
