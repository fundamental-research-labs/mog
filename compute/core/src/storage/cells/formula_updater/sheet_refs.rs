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

    compute_parser::rewrite_reference_tokens(formula, |class, text| {
        if class != compute_parser::ReferenceTokenClass::SheetRef {
            return None;
        }
        let (qualifier, reference) = text.rsplit_once('!')?;
        let referenced_sheet = qualifier
            .strip_prefix('\'')
            .and_then(|quoted| quoted.strip_suffix('\''))
            .map(|quoted| quoted.replace("''", "'"))
            .unwrap_or_else(|| qualifier.to_string());
        referenced_sheet
            .eq_ignore_ascii_case(sheet_name)
            .then(|| replacement(reference))
    })
}
