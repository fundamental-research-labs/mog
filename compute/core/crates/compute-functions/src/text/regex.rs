//! Regex text functions: REGEXEXTRACT, REGEXMATCH, REGEXREPLACE, REGEXTEST.

use regex::{Captures, Regex, RegexBuilder};
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CaseMode {
    Sensitive,
    Insensitive,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExtractMode {
    FirstMatch,
    AllMatches,
    FirstCaptures,
}

fn regex_value(message: impl Into<String>) -> CellValue {
    CellValue::error_with_message(CellError::Value, message.into())
}

fn regex_na(message: impl Into<String>) -> CellValue {
    CellValue::error_with_message(CellError::Na, message.into())
}

fn coerce_string_arg(args: &[CellValue], index: usize, name: &str) -> Result<String, CellValue> {
    if let Some(e) = check_error(&args[index]) {
        return Err(e);
    }
    args[index]
        .coerce_to_string()
        .map(|s| s.into_owned())
        .map_err(|e| CellValue::Error(e, None))
        .map_err(|v| match v {
            CellValue::Error(CellError::Value, None) => {
                regex_value(format!("{name}: argument {} must be scalar", index + 1))
            }
            other => other,
        })
}

fn parse_case(args: &[CellValue], index: usize, name: &str) -> Result<CaseMode, CellValue> {
    if index >= args.len() {
        return Ok(CaseMode::Sensitive);
    }
    if let Some(e) = check_error(&args[index]) {
        return Err(e);
    }
    let n = args[index]
        .coerce_to_number()
        .map_err(|e| CellValue::Error(e, None))?;
    if n == 0.0 {
        Ok(CaseMode::Sensitive)
    } else if n == 1.0 {
        Ok(CaseMode::Insensitive)
    } else {
        Err(regex_value(format!(
            "{name}: case_sensitivity must be 0 or 1, got {n}"
        )))
    }
}

fn parse_extract_mode(args: &[CellValue], index: usize) -> Result<ExtractMode, CellValue> {
    if index >= args.len() {
        return Ok(ExtractMode::FirstMatch);
    }
    if let Some(e) = check_error(&args[index]) {
        return Err(e);
    }
    let n = args[index]
        .coerce_to_number()
        .map_err(|e| CellValue::Error(e, None))?;
    match n {
        0.0 => Ok(ExtractMode::FirstMatch),
        1.0 => Ok(ExtractMode::AllMatches),
        2.0 => Ok(ExtractMode::FirstCaptures),
        _ => Err(regex_value(format!(
            "REGEXEXTRACT: return_mode must be 0, 1, or 2, got {n}"
        ))),
    }
}

fn parse_occurrence(args: &[CellValue], index: usize) -> Result<isize, CellValue> {
    if index >= args.len() {
        return Ok(0);
    }
    if let Some(e) = check_error(&args[index]) {
        return Err(e);
    }
    let n = args[index]
        .coerce_to_number()
        .map_err(|e| CellValue::Error(e, None))?;
    if !n.is_finite() || n.fract() != 0.0 {
        return Err(regex_value(format!(
            "REGEXREPLACE: occurrence must be an integer, got {n}"
        )));
    }
    if n < isize::MIN as f64 || n > isize::MAX as f64 {
        return Err(regex_value("REGEXREPLACE: occurrence is out of range"));
    }
    Ok(n as isize)
}

fn contains_unsupported_feature(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut escaped = false;
    for i in 0..bytes.len() {
        let b = bytes[i];
        if escaped {
            if b == b'p' || b == b'P' || b.is_ascii_digit() {
                return true;
            }
            escaped = false;
            continue;
        }
        if b == b'\\' {
            escaped = true;
            continue;
        }
        if b == b'(' && bytes.get(i + 1) == Some(&b'?') {
            match bytes.get(i + 2) {
                Some(b'=') | Some(b'!') => return true,
                Some(b'<') if matches!(bytes.get(i + 3), Some(b'=') | Some(b'!')) => return true,
                _ => {}
            }
        }
        if b == b'[' && bytes.get(i + 1) == Some(&b'[') && bytes.get(i + 2) == Some(&b':') {
            return true;
        }
    }
    false
}

fn compile_regex(pattern: &str, case: CaseMode, name: &str) -> Result<Regex, CellValue> {
    if contains_unsupported_feature(pattern) {
        return Err(regex_value(format!(
            "{name}: unsupported regex feature in pattern"
        )));
    }
    RegexBuilder::new(pattern)
        .case_insensitive(matches!(case, CaseMode::Insensitive))
        .build()
        .map_err(|e| regex_value(format!("{name}: invalid regex pattern: {e}")))
}

fn capt_text<'a>(text: &'a str, captures: &Captures<'a>, index: usize) -> &'a str {
    captures
        .get(index)
        .map_or("", |m| &text[m.start()..m.end()])
}

fn expand_replacement(captures: &Captures<'_>, replacement: &str) -> Result<String, CellValue> {
    let mut out = String::with_capacity(replacement.len());
    let mut chars = replacement.char_indices().peekable();
    while let Some((_, ch)) = chars.next() {
        if ch != '$' {
            out.push(ch);
            continue;
        }
        let Some((_, next)) = chars.peek().copied() else {
            return Err(regex_value(
                "REGEXREPLACE: replacement has a trailing bare $",
            ));
        };
        if next == '$' {
            chars.next();
            out.push('$');
            continue;
        }
        if next == '{' || next == '<' || next == '\'' {
            return Err(regex_value(
                "REGEXREPLACE: named capture replacement references are unsupported",
            ));
        }
        if !next.is_ascii_digit() {
            return Err(regex_value(
                "REGEXREPLACE: replacement $ references must be numeric",
            ));
        }
        let mut group = 0usize;
        while let Some((_, digit)) = chars.peek().copied() {
            if !digit.is_ascii_digit() {
                break;
            }
            chars.next();
            group = group * 10 + usize::from(digit as u8 - b'0');
            if group > 999 {
                return Err(regex_value(
                    "REGEXREPLACE: replacement capture reference exceeds $999",
                ));
            }
        }
        if group >= captures.len() {
            return Err(regex_value(format!(
                "REGEXREPLACE: replacement references missing capture group ${group}"
            )));
        }
        if let Some(m) = captures.get(group) {
            out.push_str(m.as_str());
        }
    }
    Ok(out)
}

fn regex_test_scalar(name: &str, args: &[CellValue], case_index: Option<usize>) -> CellValue {
    let text = match coerce_string_arg(args, 0, name) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let pattern = match coerce_string_arg(args, 1, name) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let case = match case_index {
        Some(i) => match parse_case(args, i, name) {
            Ok(c) => c,
            Err(e) => return e,
        },
        None => CaseMode::Sensitive,
    };
    let re = match compile_regex(&pattern, case, name) {
        Ok(re) => re,
        Err(e) => return e,
    };
    CellValue::Boolean(re.is_match(&text))
}

fn regex_replace_scalar(args: &[CellValue]) -> CellValue {
    let text = match coerce_string_arg(args, 0, "REGEXREPLACE") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let pattern = match coerce_string_arg(args, 1, "REGEXREPLACE") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let replacement = match coerce_string_arg(args, 2, "REGEXREPLACE") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let occurrence = match parse_occurrence(args, 3) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let case = match parse_case(args, 4, "REGEXREPLACE") {
        Ok(c) => c,
        Err(e) => return e,
    };
    let re = match compile_regex(&pattern, case, "REGEXREPLACE") {
        Ok(re) => re,
        Err(e) => return e,
    };
    let captures: Vec<Captures<'_>> = re.captures_iter(&text).collect();
    if captures.is_empty() {
        return CellValue::Text(text.into());
    }
    let selected_index = if occurrence == 0 {
        None
    } else if occurrence > 0 {
        let idx = occurrence as usize - 1;
        if idx >= captures.len() {
            return CellValue::Text(text.into());
        }
        Some(idx)
    } else {
        let from_end = (-occurrence) as usize;
        if from_end > captures.len() {
            return CellValue::Text(text.into());
        }
        Some(captures.len() - from_end)
    };

    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    for (idx, caps) in captures.iter().enumerate() {
        let Some(m) = caps.get(0) else {
            continue;
        };
        out.push_str(&text[last..m.start()]);
        if selected_index.is_none() || selected_index == Some(idx) {
            match expand_replacement(caps, &replacement) {
                Ok(s) => out.push_str(&s),
                Err(e) => return e,
            }
        } else {
            out.push_str(m.as_str());
        }
        last = m.end();
    }
    out.push_str(&text[last..]);
    CellValue::Text(out.into())
}

fn regex_extract_scalar(args: &[CellValue], forbid_spill: bool) -> CellValue {
    let text = match coerce_string_arg(args, 0, "REGEXEXTRACT") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let pattern = match coerce_string_arg(args, 1, "REGEXEXTRACT") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let mode = match parse_extract_mode(args, 2) {
        Ok(m) => m,
        Err(e) => return e,
    };
    if forbid_spill && mode != ExtractMode::FirstMatch {
        return regex_value("REGEXEXTRACT: array inputs cannot produce nested dynamic arrays");
    }
    let case = match parse_case(args, 3, "REGEXEXTRACT") {
        Ok(c) => c,
        Err(e) => return e,
    };
    let re = match compile_regex(&pattern, case, "REGEXEXTRACT") {
        Ok(re) => re,
        Err(e) => return e,
    };
    match mode {
        ExtractMode::FirstMatch => match re.find(&text) {
            Some(m) => CellValue::Text(text[m.start()..m.end()].into()),
            None => regex_na("REGEXEXTRACT: no match"),
        },
        ExtractMode::AllMatches => {
            let matches: Vec<CellValue> = re
                .find_iter(&text)
                .map(|m| CellValue::Text(text[m.start()..m.end()].into()))
                .collect();
            if matches.is_empty() {
                regex_na("REGEXEXTRACT: no match")
            } else {
                CellValue::column_array(matches)
            }
        }
        ExtractMode::FirstCaptures => {
            if re.captures_len() <= 1 {
                return regex_value(
                    "REGEXEXTRACT: return_mode 2 requires at least one capture group",
                );
            }
            let Some(caps) = re.captures(&text) else {
                return regex_na("REGEXEXTRACT: no match");
            };
            let values = (1..caps.len())
                .map(|i| CellValue::Text(capt_text(&text, &caps, i).into()))
                .collect();
            CellValue::row_array(values)
        }
    }
}

fn array_broadcast_extract(args: &[CellValue]) -> Option<CellValue> {
    let lift_indices: Vec<usize> = args
        .iter()
        .enumerate()
        .filter(|(_, arg)| matches!(arg, CellValue::Array(_)))
        .map(|(i, _)| i)
        .collect();
    if lift_indices.is_empty() {
        return None;
    }

    let mut rows = 1usize;
    let mut cols = 1usize;
    for &idx in &lift_indices {
        let CellValue::Array(a) = &args[idx] else {
            continue;
        };
        if a.rows() > 1 {
            if rows == 1 {
                rows = a.rows();
            } else if rows != a.rows() {
                return Some(regex_value(
                    "REGEXEXTRACT: array arguments have incompatible row counts",
                ));
            }
        }
        if a.cols() > 1 {
            if cols == 1 {
                cols = a.cols();
            } else if cols != a.cols() {
                return Some(regex_value(
                    "REGEXEXTRACT: array arguments have incompatible column counts",
                ));
            }
        }
    }

    let mut result = Vec::with_capacity(rows * cols);
    for r in 0..rows {
        for c in 0..cols {
            let mut scalar_args = args.to_vec();
            for &idx in &lift_indices {
                let CellValue::Array(a) = &args[idx] else {
                    continue;
                };
                let ri = if a.rows() == 1 { 0 } else { r };
                let ci = if a.cols() == 1 { 0 } else { c };
                scalar_args[idx] = a
                    .get(ri, ci)
                    .cloned()
                    .unwrap_or(CellValue::Error(CellError::Na, None));
            }
            if matches!(parse_extract_mode(&scalar_args, 2), Ok(mode) if mode != ExtractMode::FirstMatch)
            {
                return Some(regex_value(
                    "REGEXEXTRACT: array inputs cannot produce nested dynamic arrays",
                ));
            }
            let value = regex_extract_scalar(&scalar_args, true);
            if matches!(value, CellValue::Array(_)) {
                return Some(regex_value(
                    "REGEXEXTRACT: array inputs cannot produce nested dynamic arrays",
                ));
            }
            result.push(value);
        }
    }
    Some(CellValue::array(result, cols))
}

pub(crate) struct FnRegexTest;
impl PureFunction for FnRegexTest {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REGEXTEST"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        regex_test_scalar("REGEXTEST", args, Some(2))
    }
}

pub(crate) struct FnRegexMatch;
impl PureFunction for FnRegexMatch {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REGEXMATCH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        regex_test_scalar("REGEXMATCH", args, None)
    }
}

pub(crate) struct FnRegexReplace;
impl PureFunction for FnRegexReplace {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REGEXREPLACE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        regex_replace_scalar(args)
    }
}

pub(crate) struct FnRegexExtract;
impl PureFunction for FnRegexExtract {
    fn name(&self) -> &'static str {
        "REGEXEXTRACT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        array_broadcast_extract(args).unwrap_or_else(|| regex_extract_scalar(args, false))
    }
}

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnRegexExtract));
    registry.register(Box::new(FnRegexReplace));
    registry.register(Box::new(FnRegexMatch));
    registry.register(Box::new(FnRegexTest));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{bool_val, err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_regextest_default_and_case_insensitive() {
        assert_eq!(
            FnRegexTest.call(&[text("Alpha-123"), text("[0-9]+")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexTest.call(&[text("Alpha"), text("alpha")]),
            bool_val(false)
        );
        assert_eq!(
            FnRegexTest.call(&[text("Alpha"), text("alpha"), num(1.0)]),
            bool_val(true)
        );
    }

    #[test]
    fn test_regexmatch_boolean_match_and_no_match() {
        assert_eq!(
            FnRegexMatch.call(&[text("abc123"), text("^[a-z]+[0-9]+$")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("[0-9]+")]),
            bool_val(false)
        );
    }

    #[test]
    fn test_regexextract_return_modes() {
        assert_eq!(
            FnRegexExtract.call(&[text("id: A12, id: B345"), text("[A-Z][0-9]+")]),
            text("A12")
        );

        let all = FnRegexExtract.call(&[text("id: A12, id: B345"), text("[A-Z][0-9]+"), num(1.0)]);
        assert_eq!(
            all,
            CellValue::column_array(vec![text("A12"), text("B345")])
        );

        let captures = FnRegexExtract.call(&[
            text("name=alice id=42"),
            text("name=([a-z]+) id=([0-9]+)"),
            num(2.0),
        ]);
        assert_eq!(
            captures,
            CellValue::row_array(vec![text("alice"), text("42")])
        );
    }

    #[test]
    fn test_regexextract_empty_and_unmatched_optional_captures() {
        assert_eq!(
            FnRegexExtract.call(&[text("a="), text("a=(.*)"), num(2.0)]),
            CellValue::row_array(vec![text("")])
        );
        assert_eq!(
            FnRegexExtract.call(&[text("a"), text("(a)(b)?"), num(2.0)]),
            CellValue::row_array(vec![text("a"), text("")])
        );
    }

    #[test]
    fn test_regexextract_no_match_and_mode_errors() {
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("[0-9]+")]),
            err(CellError::Na)
        );
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("abc"), num(2.0)]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexExtract.call(&[text("abc"), text("abc"), num(3.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regexreplace_all_positive_negative_and_case_insensitive_occurrence() {
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x")]),
            text("ax bx cx")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x"), num(2.0)]),
            text("a1 bx c333")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1 b22 c333"), text("[0-9]+"), text("x"), num(-1.0)]),
            text("a1 b22 cx")
        );
        assert_eq!(
            FnRegexReplace.call(&[
                text("Cat cat CAT"),
                text("cat"),
                text("dog"),
                num(2.0),
                num(1.0)
            ]),
            text("Cat dog CAT")
        );
    }

    #[test]
    fn test_regexreplace_occurrence_validation_and_out_of_range() {
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(2.0)]),
            text("a1")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(-2.0)]),
            text("a1")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), num(1.5)]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("a1"), text("[0-9]+"), text("x"), text("one")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regexreplace_replacement_expansion_contract() {
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$0")]),
            text("ab12")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$2-$1")]),
            text("12-ab")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)([0-9]+)"), text("$$$1")]),
            text("$ab")
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$2")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("([a-z]+)"), text("$x")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexReplace.call(&[text("ab12"), text("(?P<word>[a-z]+)"), text("${word}")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_invalid_and_unsupported_patterns() {
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("(")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("(?=a)")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text(r"(a)\1")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text(r"\p{L}+")]),
            err(CellError::Value)
        );
        assert_eq!(
            FnRegexMatch.call(&[text("abc"), text("[[:alpha:]]+")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_coerces_numeric_and_boolean_text_inputs() {
        assert_eq!(
            FnRegexMatch.call(&[num(123.0), text("[0-9]+")]),
            bool_val(true)
        );
        assert_eq!(
            FnRegexExtract.call(&[bool_val(true), text("TR..")]),
            text("TRUE")
        );
    }

    #[test]
    fn test_regexextract_native_array_handling() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b")], vec![text("c3")]]);
        let result = reg.call("REGEXEXTRACT", &[input, text("[0-9]+"), num(0.0)]);
        assert_eq!(
            result,
            CellValue::from_rows(vec![
                vec![text("1")],
                vec![err(CellError::Na)],
                vec![text("3")]
            ])
        );
    }

    #[test]
    fn test_regexextract_rejects_nested_spills_for_array_inputs() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1 b2")]]);
        assert_eq!(
            reg.call("REGEXEXTRACT", &[input, text("[a-z][0-9]"), num(1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_regex_scalar_functions_registry_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b")]]);
        assert_eq!(
            reg.call("REGEXTEST", &[input, text("[0-9]")]),
            CellValue::from_rows(vec![vec![bool_val(true)], vec![bool_val(false)]])
        );

        let input = CellValue::from_rows(vec![vec![text("a1")], vec![text("b2")]]);
        assert_eq!(
            reg.call("REGEXREPLACE", &[input, text("[0-9]"), text("x")]),
            CellValue::from_rows(vec![vec![text("ax")], vec![text("bx")]])
        );
    }

    // -------------------------------------------------------------------
    // Registry-based tests (using FunctionRegistry::new())
    // -------------------------------------------------------------------
}
