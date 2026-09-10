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
    ThreeDRef,
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

/// Rewrite reference tokens without touching string literals or surrounding syntax.
/// The scanner uses byte offsets internally, so non-ASCII text cannot skew edits.
pub fn rewrite_reference_tokens(
    formula: &str,
    mut rewrite: impl FnMut(ReferenceTokenClass, &str) -> Option<String>,
) -> String {
    let bytes = formula.as_bytes();
    let mut result = String::new();
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i = skip_string_literal(bytes, i);
            continue;
        }
        if let Some((end, class)) = scan_reference_token(formula, i) {
            if let Some(replacement) = rewrite(class, slice_range(formula, i, end)) {
                result.push_str(slice_range(formula, copied, i));
                result.push_str(&replacement);
                copied = end;
            }
            i = end;
        } else {
            i += 1;
        }
    }
    result.push_str(slice_range(formula, copied, formula.len()));
    result
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
        b'A'..=b'Z' | b'a'..=b'z' | b'_' | b'\\' => scan_alpha_reference(formula, start),
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
    let qualifier = slice_range(formula, start + 1, i - 1);
    let class = if qualifier.contains('[') {
        ReferenceTokenClass::ExternalRef
    } else if qualifier.contains(':') {
        ReferenceTokenClass::ThreeDRef
    } else {
        ReferenceTokenClass::SheetRef
    };
    scan_ref_body(formula, after_bang).map(|end| (end, class))
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
    if formula.as_bytes().get(ident_end) == Some(&b':')
        && !is_valid_excel_a1_endpoint(formula, start, ident_end)
        && let Some(three_d) = scan_unquoted_three_d_reference(formula, ident_end + 1)
    {
        return Some(three_d);
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

fn scan_unquoted_three_d_reference(
    formula: &str,
    end_sheet_start: usize,
) -> Option<(usize, ReferenceTokenClass)> {
    let end_sheet_end = scan_identifier(formula, end_sheet_start)?;
    if formula.as_bytes().get(end_sheet_end) != Some(&b'!') {
        return None;
    }
    let after_bang = end_sheet_end + 1;
    scan_ref_body(formula, after_bang).map(|end| (end, ReferenceTokenClass::ThreeDRef))
}

fn is_valid_excel_a1_endpoint(formula: &str, start: usize, end: usize) -> bool {
    if scan_cell_endpoint(formula, start) != Some(end) {
        return false;
    }
    let reference = slice_range(formula, start, end).as_bytes();
    let mut index = usize::from(reference[0] == b'$');
    let column_start = index;
    while reference[index].is_ascii_alphabetic() {
        index += 1;
    }
    let column = excel_column_number(&reference[column_start..index]);
    index += usize::from(reference[index] == b'$');
    let row = std::str::from_utf8(&reference[index..])
        .ok()
        .and_then(|value| value.parse::<u32>().ok());
    column.is_some_and(|column| (1..=16_384).contains(&column))
        && matches!(row, Some(1..=1_048_576))
}

fn excel_column_number(column: &[u8]) -> Option<u32> {
    if !(1..=3).contains(&column.len()) || !column.iter().all(u8::is_ascii_alphabetic) {
        return None;
    }
    let mut value = 0u32;
    for byte in column {
        value = value
            .checked_mul(26)?
            .checked_add(u32::from(byte.to_ascii_uppercase() - b'A' + 1))?;
    }
    Some(value)
}

fn scan_identifier(formula: &str, start: usize) -> Option<usize> {
    let bytes = formula.as_bytes();
    let first = *bytes.get(start)?;
    if !(first == b'_' || first == b'\\' || first.is_ascii_alphabetic()) {
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
        if let Some(end) = scan_cell_endpoint(formula, after_colon)
            && formula.as_bytes().get(end) != Some(&b'!')
        {
            i = end;
        } else if let Some(end) = scan_col_endpoint(formula, after_colon)
            && is_column_endpoint_boundary(formula, end)
        {
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
    excel_column_number(&bytes[col_start..i])
        .is_some_and(|column| (1..=16_384).contains(&column))
        .then_some(i)
}

fn scan_col_range(formula: &str, start: usize) -> Option<usize> {
    let i = scan_col_endpoint(formula, start)?;
    if formula.as_bytes().get(i) != Some(&b':') {
        return None;
    }
    let end = scan_col_endpoint(formula, i + 1)?;
    is_column_endpoint_boundary(formula, end).then_some(end)
}

fn is_column_endpoint_boundary(formula: &str, end: usize) -> bool {
    !formula.as_bytes().get(end).is_some_and(|byte| {
        byte.is_ascii_alphanumeric() || matches!(byte, b'$' | b'_' | b'.' | b'!')
    })
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
    crate::structured_ref_parsing::find_outer_matching_bracket(formula, start)
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

    #[test]
    fn three_d_references_are_single_distinct_tokens() {
        let tokens = collect_reference_tokens(
            "=Start:Old!A1+'Start Sheet:Old Sheet'!$A:$A+Old!A1:Old!A2+A1:Old!A2",
        );
        let classes: Vec<_> = tokens.iter().map(|token| token.class).collect();
        let texts: Vec<_> = tokens.iter().map(|token| token.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "Start:Old!A1",
                "'Start Sheet:Old Sheet'!$A:$A",
                "Old!A1",
                "Old!A2",
                "A1",
                "Old!A2",
            ]
        );
        assert_eq!(
            classes,
            vec![
                ReferenceTokenClass::ThreeDRef,
                ReferenceTokenClass::ThreeDRef,
                ReferenceTokenClass::SheetRef,
                ReferenceTokenClass::SheetRef,
                ReferenceTokenClass::CellOrRange,
                ReferenceTokenClass::SheetRef,
            ]
        );
    }

    #[test]
    fn long_sheet_names_and_quoted_external_references_stay_distinct() {
        let tokens = collect_reference_tokens(
            "=VeryLongSheetName123:Other!A1+'C:\\dir\\[Other.xlsx]Old'!A1+😀+Old!A1",
        );
        let texts: Vec<_> = tokens.iter().map(|token| token.text.as_str()).collect();
        let classes: Vec<_> = tokens.iter().map(|token| token.class).collect();
        assert_eq!(
            texts,
            vec![
                "VeryLongSheetName123:Other!A1",
                "'C:\\dir\\[Other.xlsx]Old'!A1",
                "Old!A1",
            ]
        );
        assert_eq!(
            classes,
            vec![
                ReferenceTokenClass::ThreeDRef,
                ReferenceTokenClass::ExternalRef,
                ReferenceTokenClass::SheetRef,
            ]
        );
        assert_eq!(tokens[2].span_start, 62);
    }

    #[test]
    fn sheet_qualified_range_endpoints_are_not_consumed_as_a1_references() {
        let tokens = collect_reference_tokens(
            "=Old!A1:Sheet2!A2+A1:Sheet2!A2+Old!A1:A1!A2+Old!A1:'Sheet Two'!A2",
        );
        let texts: Vec<_> = tokens.iter().map(|token| token.text.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "Old!A1",
                "Sheet2!A2",
                "A1",
                "Sheet2!A2",
                "Old!A1",
                "A1!A2",
                "Old!A1",
                "'Sheet Two'!A2",
            ]
        );
        assert_eq!(
            tokens
                .iter()
                .filter(|token| token.text.contains('!'))
                .map(|token| token.class)
                .collect::<Vec<_>>(),
            vec![ReferenceTokenClass::SheetRef; 7]
        );
    }
}
