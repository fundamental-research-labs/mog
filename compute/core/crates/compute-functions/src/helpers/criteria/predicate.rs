use value_types::CellValue;

use super::number::try_parse_criteria_number;
use super::wildcard::WildcardPattern;

/// Parse a SUMIF/COUNTIF criteria string into a comparison function.
/// Supports: ">5", ">=5", "<5", "<=5", "=5", "<>5", "text*", plain value.
pub fn parse_criteria(criteria: &CellValue) -> Box<dyn Fn(&CellValue) -> bool> {
    let criteria_type = match criteria {
        CellValue::Number(_) => "number",
        CellValue::Boolean(_) | CellValue::Control(_) => "boolean",
        CellValue::Text(_) => "text",
        CellValue::Null => "null",
        CellValue::Image(_) => "image",
        _ => "other",
    };
    let _span = tracing::info_span!("parse_criteria", criteria_type = criteria_type).entered();
    match criteria {
        CellValue::Number(n) => {
            let n = n.get();
            Box::new(move |v: &CellValue| {
                v.as_comparable_number()
                    .is_some_and(|x| (x - n).abs() < 1e-10)
            })
        }
        CellValue::Boolean(b) => {
            let b = *b;
            Box::new(move |v: &CellValue| matches!(v, CellValue::Boolean(x) if *x == b))
        }
        CellValue::Text(s) => {
            // Trim for operator prefix detection only.  The original string
            // (with its whitespace intact) is used for plain-text and wildcard
            // matching — Excel preserves leading/trailing spaces in criteria.
            let trimmed = s.trim();
            if let Some(rest) = trimmed.strip_prefix(">=") {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    return Box::new(move |v: &CellValue| match v {
                        // COUNTIF/SUMIF: text does not participate in numeric comparisons
                        CellValue::Text(_) => false,
                        _ => v.as_comparable_number().is_some_and(|x| x >= n),
                    });
                }
                // Text comparison: case-insensitive lexicographic >=
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() >= rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix("<=") {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    // Excel type ordering: text > any number, so text is never <= number
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number().is_some_and(|x| x <= n)
                    });
                }
                // Text comparison: case-insensitive lexicographic <=
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() <= rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix("<>") {
                let rest = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest) {
                    return Box::new(move |v: &CellValue| match v.as_comparable_number() {
                        Some(x) => (x - n).abs() >= 1e-10,
                        // Unparseable text IS "not equal" to a number;
                        // Null, Boolean, Error are non-participants → false
                        None => matches!(v, CellValue::Text(_)),
                    });
                }
                // Explicit blank semantics when criteria is exactly "<>"
                if rest.is_empty() {
                    return Box::new(move |v: &CellValue| match v {
                        CellValue::Error(..) => false,
                        CellValue::Null => false,
                        _ => true, // Text("") is content (formula result), not blank
                    });
                }
                // Text <> branch for non-empty comparand (e.g., "<>hello")
                return Box::new(move |v: &CellValue| {
                    if matches!(v, CellValue::Error(..)) {
                        return false;
                    }
                    match v.coerce_to_string() {
                        Ok(vs) => !vs.eq_ignore_ascii_case(&rest),
                        Err(_) => false,
                    }
                });
            }
            if let Some(rest) = trimmed.strip_prefix('>') {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    return Box::new(move |v: &CellValue| match v {
                        // COUNTIF/SUMIF: text does not participate in numeric comparisons
                        CellValue::Text(_) => false,
                        _ => v.as_comparable_number().is_some_and(|x| x > n),
                    });
                }
                // Text comparison: case-insensitive lexicographic >
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() > rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix('<') {
                let rest_trimmed = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest_trimmed) {
                    // Excel type ordering: text > any number, so text is never < number
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number().is_some_and(|x| x < n)
                    });
                }
                // Text comparison: case-insensitive lexicographic <
                return Box::new(move |v: &CellValue| match v {
                    CellValue::Text(_) => match v.coerce_to_string() {
                        Ok(vs) => vs.to_lowercase() < rest_trimmed.to_lowercase(),
                        Err(_) => false,
                    },
                    _ => false,
                });
            }
            if let Some(rest) = trimmed.strip_prefix('=') {
                let rest = rest.trim().to_string();
                if let Some(n) = try_parse_criteria_number(&rest) {
                    return Box::new(move |v: &CellValue| {
                        v.as_comparable_number()
                            .is_some_and(|x| (x - n).abs() < 1e-10)
                    });
                }
                return Box::new(move |v: &CellValue| match v.coerce_to_string() {
                    Ok(vs) => vs.eq_ignore_ascii_case(&rest),
                    Err(_) => false,
                });
            }
            // Wildcard or plain text match
            if s.contains('*') || s.contains('?') {
                let pattern = WildcardPattern::new(s);
                Box::new(move |v: &CellValue| match v {
                    CellValue::Text(t) => pattern.matches(t),
                    _ => false,
                })
            } else {
                // Try as number first
                if let Some(n) = try_parse_criteria_number(s) {
                    Box::new(move |v: &CellValue| {
                        v.as_comparable_number()
                            .is_some_and(|x| (x - n).abs() < 1e-10)
                    })
                } else {
                    let text = s.clone();
                    Box::new(move |v: &CellValue| match v.coerce_to_string() {
                        Ok(vs) => vs.eq_ignore_ascii_case(&text),
                        Err(_) => false,
                    })
                }
            }
        }
        CellValue::Error(target, _) => {
            let target = *target;
            Box::new(move |v: &CellValue| matches!(v, CellValue::Error(e, None) if *e == target))
        }
        CellValue::Null => Box::new(|v| matches!(v, CellValue::Null)),
        CellValue::Control(c) => {
            let b = c.value;
            Box::new(move |v: &CellValue| v.as_bool() == Some(b))
        }
        CellValue::Image(image) => {
            let fallback = image.fallback_text().to_string();
            Box::new(move |v: &CellValue| {
                v.coerce_to_string()
                    .map(|s| s.eq_ignore_ascii_case(&fallback))
                    .unwrap_or(false)
            })
        }
        CellValue::Array(arr) => {
            // Extract the first scalar element from the array and use it as
            // the criteria value.  This matches Excel's behavior: when a
            // structured table reference like `Table[[#This Row],[Col]]`
            // resolves to a single-element array, SUMIF/COUNTIF should use
            // that element as the criteria.
            let scalar = arr.get(0, 0).cloned().unwrap_or(CellValue::Null);
            parse_criteria(&scalar)
        }
    }
}
