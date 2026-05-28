use regex::Regex;

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

/// Escape special regex characters in a string.
pub(super) fn escape_regex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for ch in s.chars() {
        match ch {
            '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\' => {
                result.push('\\');
                result.push(ch);
            }
            _ => result.push(ch),
        }
    }
    result
}

/// Check if a formula template contains a reference to a specific sheet name.
pub(super) fn template_contains_sheet_ref(template: &str, sheet_name: &str) -> bool {
    if sheet_name.is_empty() || template.is_empty() {
        return false;
    }

    let escaped_name = escape_regex(sheet_name);
    let unquoted_pattern = format!(r"\b{}!", escaped_name);
    if let Ok(re) = Regex::new(&unquoted_pattern)
        && re.is_match(template)
    {
        return true;
    }

    let quoted_name = sheet_name.replace('\'', "''");
    let _quoted_pattern = format!("'{}!'", escape_regex(&quoted_name));
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_name));
    if let Ok(re) = Regex::new(&quoted_pattern)
        && re.is_match(template)
    {
        return true;
    }

    false
}

/// Replace a sheet name in a formula template string.
pub(super) fn replace_sheet_name_in_template(
    template: &str,
    old_name: &str,
    new_name: &str,
) -> String {
    if old_name.is_empty() || template.is_empty() {
        return template.to_string();
    }

    let new_formatted = escape_sheet_name_for_formula(new_name);
    let replacement = format!("{}!", new_formatted);
    let mut result = template.to_string();

    let quoted_old = old_name.replace('\'', "''");
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_old));
    if let Ok(re) = Regex::new(&quoted_pattern) {
        result = re.replace_all(&result, replacement.as_str()).to_string();
    }

    if !sheet_name_needs_quoting(old_name) {
        let unquoted_pattern = format!("{}!", escape_regex(old_name));
        if let Ok(re) = Regex::new(&unquoted_pattern) {
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    result
}

/// Replace sheet name in an A1 formula string.
pub(super) fn replace_sheet_name_in_a1_formula(
    formula: &str,
    old_name: &str,
    new_name: &str,
) -> String {
    if old_name.is_empty() || formula.is_empty() {
        return formula.to_string();
    }

    let new_formatted = escape_sheet_name_for_formula(new_name);
    let replacement = format!("{}!", new_formatted);
    let mut result = formula.to_string();

    let quoted_old = old_name.replace('\'', "''");
    let quoted_pattern = format!("'{}'!", escape_regex(&quoted_old));
    if let Ok(re) = Regex::new(&quoted_pattern) {
        result = re.replace_all(&result, replacement.as_str()).to_string();
    }

    if !sheet_name_needs_quoting(old_name) {
        let unquoted_pattern = format!("{}!", escape_regex(old_name));
        if let Ok(re) = Regex::new(&unquoted_pattern) {
            result = re.replace_all(&result, replacement.as_str()).to_string();
        }
    }

    result
}
