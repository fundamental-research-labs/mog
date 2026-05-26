//! Spanned reference-like token collection for diagnostics.
//!
//! This collector intentionally runs before AST construction can collapse
//! authored broken references into `ASTNode::Error(CellError::Ref)`. It is a
//! lightweight lexical pass over the displayed formula string, including the
//! leading `=` in returned UTF-16 offsets.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReferenceToken {
    pub class: ReferenceTokenClass,
    pub text: String,
    pub span_start: u32,
    pub span_end: u32,
    pub ref_index: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceTokenClass {
    CellOrRange,
    BrokenRef,
    SheetRef,
    Name,
    StructuredRef,
    ExternalRef,
}

#[must_use]
pub fn collect_reference_tokens(formula: &str) -> Vec<ReferenceToken> {
    let mut out = Vec::new();
    let bytes = formula.as_bytes();
    let mut i = 0usize;
    let mut ref_index = 0u32;

    while i < bytes.len() {
        if bytes[i] == b'"' {
            i = skip_string_literal(bytes, i);
            continue;
        }
        if let Some((end, class)) = scan_reference_token(formula, i) {
            push_token(formula, i, end, class, ref_index, &mut out);
            ref_index += 1;
            i = end;
        } else {
            i += 1;
        }
    }

    out
}

fn skip_string_literal(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i += 1;
            if bytes.get(i) == Some(&b'"') {
                i += 1;
                continue;
            }
            break;
        }
        i += 1;
    }
    i
}

fn scan_reference_token(formula: &str, start: usize) -> Option<(usize, ReferenceTokenClass)> {
    let bytes = formula.as_bytes();
    match bytes.get(start).copied()? {
        b'\'' => scan_quoted_reference(formula, start),
        b'[' => scan_external_reference(formula, start)
            .map(|end| (end, ReferenceTokenClass::ExternalRef)),
        b'#' if starts_at(formula, start, "#REF!") => Some((
            scan_broken_ref_construct(formula, start),
            ReferenceTokenClass::BrokenRef,
        )),
        b'$' => scan_cell_or_range(formula, start)
            .or_else(|| scan_col_range(formula, start))
            .map(|end| (end, reference_class_for_span(formula, start, end))),
        b'A'..=b'Z' | b'a'..=b'z' | b'_' => scan_alpha_reference(formula, start),
        b'0'..=b'9' => {
            scan_row_range(formula, start).map(|end| (end, ReferenceTokenClass::CellOrRange))
        }
        _ => None,
    }
}

fn reference_class_for_span(formula: &str, start: usize, end: usize) -> ReferenceTokenClass {
    if slice_range(formula, start, end).contains("#REF!") {
        ReferenceTokenClass::BrokenRef
    } else {
        ReferenceTokenClass::CellOrRange
    }
}

fn push_token(
    formula: &str,
    start: usize,
    end: usize,
    class: ReferenceTokenClass,
    ref_index: u32,
    out: &mut Vec<ReferenceToken>,
) {
    out.push(ReferenceToken {
        class,
        text: slice_range(formula, start, end).to_string(),
        span_start: utf16_offset(formula, start),
        span_end: utf16_offset(formula, end),
        ref_index,
    });
}

fn utf16_offset(s: &str, byte: usize) -> u32 {
    let count = s
        .get(..byte)
        .expect("reference token scanner only emits UTF-8 boundary offsets")
        .encode_utf16()
        .count();
    u32::try_from(count).expect("formula UTF-16 offset fits in u32")
}

fn starts_at(s: &str, start: usize, needle: &str) -> bool {
    s.get(start..)
        .is_some_and(|suffix| suffix.starts_with(needle))
}

fn slice_from(s: &str, start: usize) -> Option<&str> {
    s.get(start..)
}

fn slice_range(s: &str, start: usize, end: usize) -> &str {
    s.get(start..end)
        .expect("reference token scanner only emits UTF-8 boundary offsets")
}

fn scan_quoted_reference(formula: &str, start: usize) -> Option<(usize, ReferenceTokenClass)> {
    let mut i = start + 1;
    let bytes = formula.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'\'' {
            i += 1;
            if bytes.get(i) == Some(&b'\'') {
                i += 1;
                continue;
            }
            break;
        }
        i += 1;
    }
    if bytes.get(i) != Some(&b'!') {
        return None;
    }
    let after_bang = i + 1;
    if starts_at(formula, after_bang, "#REF!") {
        return Some((
            scan_broken_ref_construct(formula, after_bang),
            ReferenceTokenClass::BrokenRef,
        ));
    }
    scan_ref_body(formula, after_bang).map(|end| (end, ReferenceTokenClass::SheetRef))
}

fn scan_external_reference(formula: &str, start: usize) -> Option<usize> {
    let close = slice_from(formula, start)?.find(']')? + start;
    let mut i = close + 1;
    while i < formula.len() {
        let b = formula.as_bytes()[i];
        if matches!(b, b'+' | b'-' | b'*' | b'/' | b'^' | b'&' | b',' | b')') {
            break;
        }
        if b.is_ascii_whitespace() {
            break;
        }
        i += 1;
    }
    (i > close + 1).then_some(i)
}

fn scan_alpha_reference(formula: &str, start: usize) -> Option<(usize, ReferenceTokenClass)> {
    let ident_end = scan_identifier(formula, start)?;
    if formula.as_bytes().get(ident_end) == Some(&b'(') {
        return None;
    }
    if formula.as_bytes().get(ident_end) == Some(&b'!') {
        let after_bang = ident_end + 1;
        if starts_at(formula, after_bang, "#REF!") {
            return Some((
                scan_broken_ref_construct(formula, after_bang),
                ReferenceTokenClass::BrokenRef,
            ));
        }
        return scan_ref_body(formula, after_bang).map(|end| (end, ReferenceTokenClass::SheetRef));
    }
    if formula.as_bytes().get(ident_end) == Some(&b'[')
        && let Some(end) = find_matching_bracket(formula, ident_end)
    {
        return Some((end + 1, ReferenceTokenClass::StructuredRef));
    }
    if let Some(end) = scan_cell_or_range(formula, start) {
        return Some((end, reference_class_for_span(formula, start, end)));
    }
    if let Some(end) = scan_col_range(formula, start) {
        return Some((end, ReferenceTokenClass::CellOrRange));
    }
    let ident = slice_range(formula, start, ident_end);
    if matches_ignore_ascii_case(ident, &["TRUE", "FALSE"]) {
        return None;
    }
    Some((ident_end, ReferenceTokenClass::Name))
}

fn scan_identifier(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let first = *bytes.get(start)?;
    if !(first == b'_' || first.is_ascii_alphabetic()) {
        return None;
    }
    let mut i = start + 1;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'_' || b == b'.' || b.is_ascii_alphanumeric() {
            i += 1;
        } else {
            break;
        }
    }
    Some(i)
}

fn scan_cell_or_range(formula: &str, start: usize) -> Option<usize> {
    let mut i = scan_cell_endpoint(formula, start)?;
    if formula.as_bytes().get(i) == Some(&b':') {
        let after_colon = i + 1;
        if starts_at(formula, after_colon, "#REF!") {
            return Some(scan_broken_ref_construct(formula, after_colon));
        }
        if let Some(end) = scan_cell_endpoint(formula, after_colon) {
            i = end;
        } else if let Some(end) = scan_col_endpoint(formula, after_colon) {
            i = end;
        }
    }
    Some(i)
}

fn scan_ref_body(formula: &str, start: usize) -> Option<usize> {
    if starts_at(formula, start, "#REF!") {
        Some(scan_broken_ref_construct(formula, start))
    } else {
        scan_cell_or_range(formula, start)
            .or_else(|| scan_col_range(formula, start))
            .or_else(|| scan_row_range(formula, start))
            .or_else(|| scan_identifier(formula, start))
    }
}

fn scan_cell_endpoint(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let mut i = start;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    let col_start = i;
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        i += 1;
    }
    if i == col_start {
        return None;
    }
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    let row_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == row_start {
        return None;
    }
    let next = bytes.get(i).copied();
    if next.is_some_and(|b| b == b'_' || b.is_ascii_alphanumeric()) {
        return None;
    }
    Some(i)
}

fn scan_col_endpoint(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let mut i = start;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    let col_start = i;
    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        i += 1;
    }
    (i > col_start).then_some(i)
}

fn scan_col_range(formula: &str, start: usize) -> Option<usize> {
    let i = scan_col_endpoint(formula, start)?;
    if formula.as_bytes().get(i) != Some(&b':') {
        return None;
    }
    scan_col_endpoint(formula, i + 1)
}

fn scan_row_range(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let mut i = start;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    let row_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == row_start || bytes.get(i) != Some(&b':') {
        return None;
    }
    i += 1;
    if bytes.get(i) == Some(&b'$') {
        i += 1;
    }
    let second_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    (i > second_start).then_some(i)
}

fn scan_broken_ref_construct(formula: &str, start: usize) -> usize {
    let mut i = start;
    while starts_at(formula, i, "#REF!") {
        i += 5;
    }
    if let Some(end) = scan_cell_or_range(formula, i)
        .or_else(|| scan_col_range(formula, i))
        .or_else(|| scan_row_range(formula, i))
    {
        i = end;
    }
    i
}

fn find_matching_bracket(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let mut depth = 0u32;
    let mut i = start;
    while i < bytes.len() {
        match bytes[i] {
            b'[' => depth += 1,
            b']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|c| value.eq_ignore_ascii_case(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broken_ref_forms_keep_independent_spans() {
        let tokens = collect_reference_tokens("=A1:#REF!+Sheet1!#REF!+#REF!A1+#REF!");
        let texts: Vec<_> = tokens.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(texts, vec!["A1:#REF!", "Sheet1!#REF!", "#REF!A1", "#REF!"]);
        assert_eq!(tokens[0].span_start, 1);
        assert_eq!(tokens[0].span_end, 9);
        assert!(
            tokens
                .iter()
                .all(|t| t.class == ReferenceTokenClass::BrokenRef)
        );
    }

    #[test]
    fn duplicate_tokens_have_distinct_spans_and_indices() {
        let tokens = collect_reference_tokens("=A1+A1");
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].text, "A1");
        assert_eq!(tokens[0].span_start, 1);
        assert_eq!(tokens[0].ref_index, 0);
        assert_eq!(tokens[1].text, "A1");
        assert_eq!(tokens[1].span_start, 4);
        assert_eq!(tokens[1].ref_index, 1);
    }

    #[test]
    fn utf16_offsets_include_leading_equals() {
        let tokens = collect_reference_tokens("=😀+A1");
        assert_eq!(tokens[0].span_start, 4);
        assert_eq!(tokens[0].span_end, 6);
    }
}
