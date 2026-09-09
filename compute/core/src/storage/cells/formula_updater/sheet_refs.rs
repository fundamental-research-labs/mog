/// Check if a sheet name needs quoting in Excel formulas.
pub(super) fn sheet_name_needs_quoting(name: &str) -> bool {
    compute_parser::needs_quoting(name)
}

/// Escape a sheet name for use in formulas.
pub(super) fn escape_sheet_name_for_formula(name: &str) -> String {
    if name.is_empty() {
        return "''".to_string();
    }
    if !sheet_name_needs_quoting(name) {
        return name.to_string();
    }
    let escaped = name.replace('\'', "''");
    format!("'{}'", escaped)
}

/// Replace sheet name in an A1 formula string.
pub(crate) fn replace_sheet_name_in_a1_formula(
    formula: &str,
    old_name: &str,
    new_name: &str,
) -> String {
    rewrite_sheet_reference_tokens(formula, old_name, |reference| {
        format!("{}!{reference}", escape_sheet_name_for_formula(new_name))
    })
}

/// Replace references to a deleted sheet with Excel's broken-reference token.
pub(crate) fn invalidate_sheet_references_in_a1_formula(formula: &str, sheet_name: &str) -> String {
    rewrite_sheet_reference_tokens(formula, sheet_name, |_| "#REF!".to_string())
}

fn rewrite_sheet_reference_tokens(
    formula: &str,
    sheet_name: &str,
    mut replacement: impl FnMut(&str) -> String,
) -> String {
    if sheet_name.is_empty() || formula.is_empty() {
        return formula.to_string();
    }

    let mut result = String::new();
    let mut copied = 0;
    for token in compute_parser::collect_reference_tokens(formula) {
        if token.class != compute_parser::ReferenceTokenClass::SheetRef {
            continue;
        }
        let Some(start) = byte_offset_for_utf16(formula, token.span_start) else {
            continue;
        };
        let Some(end) = byte_offset_for_utf16(formula, token.span_end) else {
            continue;
        };
        let Some((qualifier, reference)) = token.text.rsplit_once('!') else {
            continue;
        };
        let referenced_sheet = qualifier
            .strip_prefix('\'')
            .and_then(|quoted| quoted.strip_suffix('\''))
            .map(|quoted| quoted.replace("''", "'"))
            .unwrap_or_else(|| qualifier.to_string());
        if referenced_sheet.eq_ignore_ascii_case(sheet_name) {
            result.push_str(&formula[copied..start]);
            result.push_str(&replacement(reference));
            copied = end;
        }
    }
    result.push_str(&formula[copied..]);
    result
}

fn byte_offset_for_utf16(value: &str, target: u32) -> Option<usize> {
    let mut offset = 0;
    for (byte, ch) in value.char_indices() {
        if offset == target {
            return Some(byte);
        }
        offset = offset.checked_add(ch.len_utf16() as u32)?;
        if offset > target {
            return None;
        }
    }
    (offset == target).then_some(value.len())
}
