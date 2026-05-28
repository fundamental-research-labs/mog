/// Walk a formula body and yield each identifier-token byte range that is a
/// candidate for named-range rewriting.
pub(super) fn formula_identifier_candidates(formula: &str) -> Vec<(usize, usize)> {
    let bytes = formula.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'"' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'"' {
                        if i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            b'\'' => {
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == b'\'' {
                        if i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    i += 1;
                }
            }
            _ if b.is_ascii_alphabetic() || b == b'_' => {
                let start = i;
                i += 1;
                while i < bytes.len()
                    && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'.')
                {
                    i += 1;
                }
                let end = i;
                let mut peek = end;
                while peek < bytes.len() && bytes[peek].is_ascii_whitespace() {
                    peek += 1;
                }
                let next = bytes.get(peek).copied();
                if matches!(next, Some(b'!' | b'[' | b'(')) {
                    continue;
                }
                out.push((start, end));
            }
            _ if b.is_ascii_digit() => {
                i += 1;
                while i < bytes.len()
                    && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'.' || bytes[i] == b'_')
                {
                    i += 1;
                }
            }
            _ => {
                i += 1;
            }
        }
    }
    out
}

/// Check if a formula body references a specific named range.
pub(super) fn formula_contains_name_ref(formula: &str, name: &str) -> bool {
    if name.is_empty() || formula.is_empty() {
        return false;
    }
    for (start, end) in formula_identifier_candidates(formula) {
        #[allow(clippy::string_slice)]
        let token = &formula[start..end];
        if token.eq_ignore_ascii_case(name) {
            return true;
        }
    }
    false
}

/// Replace a named range identifier in a formula body with a new name.
pub(super) fn replace_name_in_formula(formula: &str, old_name: &str, new_name: &str) -> String {
    if formula.is_empty() || old_name.is_empty() {
        return formula.to_string();
    }
    let candidates = formula_identifier_candidates(formula);
    let mut out = String::with_capacity(formula.len());
    let mut cursor = 0;
    for (start, end) in candidates {
        if start < cursor {
            continue;
        }
        #[allow(clippy::string_slice)]
        let token = &formula[start..end];
        if token.eq_ignore_ascii_case(old_name) {
            let Some(prefix) = formula.get(cursor..start) else {
                return formula.to_string();
            };
            out.push_str(prefix);
            out.push_str(new_name);
            cursor = end;
        }
    }
    let Some(suffix) = formula.get(cursor..) else {
        return formula.to_string();
    };
    out.push_str(suffix);
    out
}
