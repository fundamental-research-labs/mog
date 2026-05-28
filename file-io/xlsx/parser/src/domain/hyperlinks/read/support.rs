//! Small XML scanning helpers for hyperlink parsing.

/// Find the end of an XML element (the closing `>` character).
///
/// Handles quoted attribute values so a literal `>` inside an attribute does not
/// end the element.
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

    #[test]
    fn quoted_gt_does_not_end_element() {
        let xml = br#"<hyperlink ref="A1" display="A > B" tooltip="still > quoted"/>"#;
        let end = find_element_end_simple(xml, 0).unwrap();

        assert_eq!(xml[end], b'>');
        assert_eq!(&xml[end - 1..=end], b"/>");
    }
}
