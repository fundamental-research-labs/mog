use super::ParseError;

pub(super) fn count_worksheet_cell_elements(xml: &[u8]) -> usize {
    let mut count = 0usize;
    let mut pos = 0usize;
    while let Some(rel) = memchr::memmem::find(&xml[pos..], b"<c") {
        let start = pos + rel;
        let next = start + 2;
        if next >= xml.len() || matches!(xml[next], b' ' | b'>' | b'/' | b'\t' | b'\n' | b'\r') {
            count += 1;
        }
        pos = next;
    }
    count
}

pub(super) fn ensure_lazy_limit(label: &str, count: usize, limit: usize) -> Result<(), ParseError> {
    if count > limit {
        Err(ParseError::ParseFailed(format!(
            "{label} count {count} exceeds XLSX parser safety limit {limit}"
        )))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_worksheet_cell_elements() {
        let cases = [
            (b"<cols>".as_slice(), 0),
            (b"<col>".as_slice(), 0),
            (b"<conditionalFormatting>".as_slice(), 0),
            (b"<c>".as_slice(), 1),
            (b"<c/>".as_slice(), 1),
            (b"<c r=\"A1\">".as_slice(), 1),
            (b"<c\tfoo=\"bar\">".as_slice(), 1),
            (b"<c\nfoo=\"bar\">".as_slice(), 1),
            (b"<c\rfoo=\"bar\">".as_slice(), 1),
            (b"<c".as_slice(), 1),
        ];

        for (xml, expected) in cases {
            assert_eq!(count_worksheet_cell_elements(xml), expected);
        }
    }

    #[test]
    fn lazy_limit_error_preserves_message() {
        let err = ensure_lazy_limit("worksheet cell", 11, 10).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Parse failed: worksheet cell count 11 exceeds XLSX parser safety limit 10"
        );
    }
}
