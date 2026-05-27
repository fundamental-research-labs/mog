//! Search functions: FIND, SEARCH, SUBSTITUTE, REPLACE

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::helpers::criteria::WildcardPattern;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnFind;
impl PureFunction for FnFind {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FIND"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let find_text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let within_text = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("FIND: start_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => (n as usize).saturating_sub(1),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // FIND is case-sensitive
        let search_in = &within_text[within_text
            .char_indices()
            .nth(start_num)
            .map_or(within_text.len(), |(i, _)| i)..];
        match search_in.find(&*find_text) {
            Some(pos) => {
                // Convert byte offset to char offset, add start_num, 1-based
                let char_pos = search_in[..pos].chars().count();
                CellValue::number((char_pos + start_num + 1) as f64)
            }
            None => CellValue::error_with_message(
                CellError::Value,
                format!("FIND: '{find_text}' not found in '{within_text}'"),
            ),
        }
    }
}

pub(crate) struct FnSearch;
impl PureFunction for FnSearch {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SEARCH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let find_text = match args[0].coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(e) => return CellValue::Error(e, None),
        };
        let within_text = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("SEARCH: start_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => (n as usize).saturating_sub(1),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // SEARCH is case-insensitive and supports wildcards
        let within_lower = within_text.to_lowercase();
        let search_in: String = within_lower.chars().skip(start_num).collect();
        if find_text.contains('*') || find_text.contains('?') {
            // Wildcard search - find first matching position
            let pattern = WildcardPattern::new(&find_text);
            let search_chars: Vec<char> = search_in.chars().collect();
            for i in 0..=search_chars.len() {
                let remaining: String = search_chars[i..].iter().collect();
                if pattern.matches(&remaining) {
                    return CellValue::number((i + start_num + 1) as f64);
                }
                // Also try matching just starting from position i
                for j in i..=search_chars.len() {
                    let substr: String = search_chars[i..j].iter().collect();
                    if pattern.matches(&substr) {
                        return CellValue::number((i + start_num + 1) as f64);
                    }
                }
            }
            CellValue::error_with_message(
                CellError::Value,
                format!("SEARCH: '{find_text}' not found in '{within_text}'"),
            )
        } else {
            match search_in.find(&find_text) {
                Some(pos) => {
                    let char_pos = search_in[..pos].chars().count();
                    CellValue::number((char_pos + start_num + 1) as f64)
                }
                None => CellValue::error_with_message(
                    CellError::Value,
                    format!("SEARCH: '{find_text}' not found in '{within_text}'"),
                ),
            }
        }
    }
}

pub(crate) struct FnSubstitute;
impl PureFunction for FnSubstitute {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "SUBSTITUTE"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        if let Some(e) = check_error(&args[2]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let old_text = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let new_text = match args[2].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        if old_text.is_empty() {
            return CellValue::Text(text.into());
        }
        let instance_num = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) if n < 1.0 => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("SUBSTITUTE: instance_num must be >= 1, got {n}"),
                    );
                }
                Ok(n) => Some(n as usize),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            None
        };

        match instance_num {
            None => {
                // Replace all occurrences
                CellValue::Text(text.replace(&old_text, &new_text).into())
            }
            Some(instance) => {
                // Replace only the Nth occurrence
                let mut count = 0usize;
                let mut result = String::new();
                let mut remaining = text.as_str();
                while let Some(pos) = remaining.find(&old_text) {
                    count += 1;
                    if count == instance {
                        result.push_str(&remaining[..pos]);
                        result.push_str(&new_text);
                        result.push_str(&remaining[pos + old_text.len()..]);
                        return CellValue::Text(result.into());
                    }
                    result.push_str(&remaining[..pos + old_text.len()]);
                    remaining = &remaining[pos + old_text.len()..];
                }
                result.push_str(remaining);
                CellValue::Text(result.into())
            }
        }
    }
}

pub(crate) struct FnReplace;
impl PureFunction for FnReplace {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "REPLACE"
    }
    fn min_args(&self) -> usize {
        4
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        for arg in args.iter().take(4) {
            if let Some(e) = check_error(arg) {
                return e;
            }
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let start = match args[1].coerce_to_number() {
            Ok(n) if n < 1.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("REPLACE: start_num must be >= 1, got {n}"),
                );
            }
            Ok(n) => (n as usize).saturating_sub(1),
            Err(e) => return CellValue::Error(e, None),
        };
        let num_chars = match args[2].coerce_to_number() {
            Ok(n) if n < 0.0 => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("REPLACE: num_chars must be >= 0, got {n}"),
                );
            }
            Ok(n) => n as usize,
            Err(e) => return CellValue::Error(e, None),
        };
        let new_text = match args[3].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };

        let chars: Vec<char> = text.chars().collect();
        let start = start.min(chars.len());
        let end = (start + num_chars).min(chars.len());

        let mut result = String::new();
        for c in &chars[..start] {
            result.push(*c);
        }
        result.push_str(&new_text);
        for c in &chars[end..] {
            result.push(*c);
        }
        CellValue::Text(result.into())
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFind));
    registry.register(Box::new(FnSearch));
    registry.register(Box::new(FnSubstitute));
    registry.register(Box::new(FnReplace));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{err, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::CellError;

    #[test]
    fn test_find() {
        let f = FnFind;
        assert_eq!(f.call(&[text("ll"), text("hello")]), num(3.0));
        assert_eq!(f.call(&[text("LL"), text("hello")]), err(CellError::Value)); // case-sensitive
        assert_eq!(f.call(&[text("xyz"), text("hello")]), err(CellError::Value));
    }

    #[test]
    fn test_search() {
        let f = FnSearch;
        assert_eq!(f.call(&[text("LL"), text("hello")]), num(3.0)); // case-insensitive
    }

    #[test]
    fn test_substitute() {
        let f = FnSubstitute;
        assert_eq!(
            f.call(&[text("hello world hello"), text("hello"), text("hi")]),
            text("hi world hi")
        );
        assert_eq!(
            f.call(&[
                text("hello world hello"),
                text("hello"),
                text("hi"),
                num(2.0)
            ]),
            text("hello world hi")
        );
    }

    #[test]
    fn test_replace() {
        let f = FnReplace;
        assert_eq!(
            f.call(&[text("hello"), num(2.0), num(3.0), text("a")]),
            text("hao")
        );
    }

    #[test]
    fn test_find_basic() {
        // FIND("b", "abc") = 2
        assert_eq!(FnFind.call(&[text("b"), text("abc")]), num(2.0));
    }

    #[test]
    fn test_find_case_sensitive_not_found() {
        // FIND("B", "abc") = #VALUE!
        assert_eq!(
            FnFind.call(&[text("B"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_find_at_beginning() {
        assert_eq!(FnFind.call(&[text("a"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_find_at_end() {
        assert_eq!(FnFind.call(&[text("c"), text("abc")]), num(3.0));
    }

    #[test]
    fn test_find_multi_char() {
        assert_eq!(FnFind.call(&[text("bc"), text("abcbc")]), num(2.0));
    }

    #[test]
    fn test_find_empty_find_text() {
        // FIND("", "abc") = 1 (Excel: empty string is found at position 1)
        assert_eq!(FnFind.call(&[text(""), text("abc")]), num(1.0));
    }

    #[test]
    fn test_find_with_start_num() {
        // FIND("b", "abcabc", 3) = 5
        assert_eq!(
            FnFind.call(&[text("b"), text("abcabc"), num(3.0)]),
            num(5.0)
        );
    }

    #[test]
    fn test_find_start_num_less_than_one() {
        assert_eq!(
            FnFind.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_find_not_found() {
        assert_eq!(
            FnFind.call(&[text("xyz"), text("hello")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_search_case_insensitive() {
        // SEARCH("b", "aBc") = 2
        assert_eq!(FnSearch.call(&[text("b"), text("aBc")]), num(2.0));
    }

    #[test]
    fn test_search_wildcard_star() {
        // SEARCH("*", "abc") = 1
        assert_eq!(FnSearch.call(&[text("*"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_search_wildcard_question_mark() {
        // SEARCH("?b", "abc") = 1 (? matches 'a', then 'b')
        assert_eq!(FnSearch.call(&[text("?b"), text("abc")]), num(1.0));
    }

    #[test]
    fn test_search_wildcard_not_found() {
        assert_eq!(
            FnSearch.call(&[text("?z"), text("abc")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_search_with_start_num() {
        assert_eq!(
            FnSearch.call(&[text("o"), text("hello world"), num(6.0)]),
            num(8.0)
        );
    }

    #[test]
    fn test_search_start_num_less_than_one() {
        assert_eq!(
            FnSearch.call(&[text("a"), text("abc"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_all_occurrences() {
        assert_eq!(
            FnSubstitute.call(&[text("hello world"), text("world"), text("earth")]),
            text("hello earth")
        );
    }

    #[test]
    fn test_substitute_multiple_occurrences() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b")]),
            text("bbb")
        );
    }

    #[test]
    fn test_substitute_nth_instance() {
        // Replace only 2nd "a" in "aaa"
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(2.0)]),
            text("aba")
        );
    }

    #[test]
    fn test_substitute_1st_instance() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(1.0)]),
            text("baa")
        );
    }

    #[test]
    fn test_substitute_3rd_instance() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(3.0)]),
            text("aab")
        );
    }

    #[test]
    fn test_substitute_instance_not_found() {
        // Instance 4 doesn't exist in "aaa" (only 3 'a's) - returns original
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(4.0)]),
            text("aaa")
        );
    }

    #[test]
    fn test_substitute_empty_old_text() {
        // Empty old_text -> return original unchanged
        assert_eq!(
            FnSubstitute.call(&[text("hello"), text(""), text("x")]),
            text("hello")
        );
    }

    #[test]
    fn test_substitute_instance_zero_error() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_negative_instance_error() {
        assert_eq!(
            FnSubstitute.call(&[text("aaa"), text("a"), text("b"), num(-1.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_substitute_not_found() {
        assert_eq!(
            FnSubstitute.call(&[text("hello"), text("xyz"), text("abc")]),
            text("hello")
        );
    }

    #[test]
    fn test_replace_basic() {
        // REPLACE("abcdef", 3, 2, "XY") = "abXYef"
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(3.0), num(2.0), text("XY")]),
            text("abXYef")
        );
    }

    #[test]
    fn test_replace_at_start() {
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(1.0), num(2.0), text("ZZ")]),
            text("ZZcdef")
        );
    }

    #[test]
    fn test_replace_at_end() {
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(5.0), num(2.0), text("XY")]),
            text("abcdXY")
        );
    }

    #[test]
    fn test_replace_zero_chars_insert() {
        // num_chars=0 means insert without removing
        assert_eq!(
            FnReplace.call(&[text("abc"), num(2.0), num(0.0), text("X")]),
            text("aXbc")
        );
    }

    #[test]
    fn test_replace_entire_string() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(1.0), num(3.0), text("XYZ")]),
            text("XYZ")
        );
    }

    #[test]
    fn test_replace_start_less_than_one_error() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(0.0), num(1.0), text("X")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_replace_negative_num_chars_error() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(1.0), num(-1.0), text("X")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_replace_with_longer_replacement() {
        assert_eq!(
            FnReplace.call(&[text("abc"), num(2.0), num(1.0), text("XXXX")]),
            text("aXXXXc")
        );
    }

    #[test]
    fn test_replace_with_empty_replacement() {
        // Delete characters
        assert_eq!(
            FnReplace.call(&[text("abcdef"), num(3.0), num(2.0), text("")]),
            text("abef")
        );
    }

    #[test]
    fn test_replace_error_propagation() {
        assert_eq!(
            FnReplace.call(&[err(CellError::Div0), num(1.0), num(1.0), text("X")]),
            err(CellError::Div0)
        );
    }

    // -------------------------------------------------------------------
    // regex.rs — REGEXEXTRACT, REGEXREPLACE, REGEXMATCH, REGEXTEST
    // -------------------------------------------------------------------
}
