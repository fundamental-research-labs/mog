use value_types::{CellError, CellValue, FiniteF64};

/// Try to interpret `input` as a literal scalar -- number, bool, quoted text,
/// or error token. Returns `None` if the shape isn't literal-like.
pub(super) fn try_parse_constant_literal(input: &str) -> Option<CellValue> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(err) = CellError::parse_error_str(trimmed) {
        return Some(CellValue::from(err));
    }

    if trimmed.eq_ignore_ascii_case("TRUE") {
        return Some(CellValue::Boolean(true));
    }
    if trimmed.eq_ignore_ascii_case("FALSE") {
        return Some(CellValue::Boolean(false));
    }

    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        // starts_with('"') + ends_with('"') guarantee both edges are
        // single-byte ASCII '"'; `[1..len-1]` is at char boundaries.
        #[allow(clippy::string_slice)]
        let inner = &trimmed[1..trimmed.len() - 1];
        let unescaped = inner.replace("\"\"", "\"");
        if inner.bytes().filter(|&b| b == b'"').count() % 2 == 0 {
            return Some(CellValue::from(unescaped));
        }
        return None;
    }

    if let Ok(n) = trimmed.parse::<f64>()
        && n.is_finite()
    {
        return Some(CellValue::Number(FiniteF64::must(n)));
    }

    None
}

/// Emit a [`CellValue`] as a formula-style literal.
pub(super) fn constant_to_a1(v: &CellValue) -> String {
    match v {
        CellValue::Boolean(true) => "TRUE".to_string(),
        CellValue::Boolean(false) => "FALSE".to_string(),
        CellValue::Number(n) => {
            let f = **n;
            #[allow(clippy::float_cmp)]
            if f == f.trunc() && f.abs() < 1e15 {
                #[allow(clippy::cast_possible_truncation)]
                {
                    (f as i64).to_string()
                }
            } else {
                format!("{f}")
            }
        }
        CellValue::Text(s) => format!("\"{}\"", s.replace('"', "\"\"")),
        CellValue::Error(e, _) => e.as_str().to_string(),
        CellValue::Null | CellValue::Array(_) | CellValue::Control(_) | CellValue::Image(_) => {
            String::new()
        }
    }
}
