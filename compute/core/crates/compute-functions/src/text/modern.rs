//! Modern Text functions (Excel 365): TEXTBEFORE, TEXTAFTER, TEXTSPLIT

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnTextBefore;
impl PureFunction for FnTextBefore {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTBEFORE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let delimiter = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let instance_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let match_mode = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let match_end = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        // if_not_found: if provided, return that on failure; else #N/A
        let if_not_found = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                format!("TEXTBEFORE: delimiter '{delimiter}' not found in text"),
            )
        };

        if instance_num == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "TEXTBEFORE: instance_num must not be 0",
            );
        }
        if delimiter.is_empty() {
            return if match_end != 0 {
                CellValue::Text(text.into())
            } else {
                CellValue::error_with_message(
                    CellError::Value,
                    "TEXTBEFORE: delimiter must not be empty",
                )
            };
        }

        // Build char-index positions: find all occurrences using char indices
        let text_chars: Vec<char> = text.chars().collect();
        let delim_chars: Vec<char> = if match_mode == 1 {
            delimiter.to_lowercase().chars().collect()
        } else {
            delimiter.chars().collect()
        };
        let search_chars: Vec<char> = if match_mode == 1 {
            text.to_lowercase().chars().collect()
        } else {
            text_chars.clone()
        };

        let mut positions = Vec::new(); // char-based positions
        let mut i = 0;
        while i + delim_chars.len() <= search_chars.len() {
            if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                positions.push(i);
                i += delim_chars.len(); // advance by delimiter length (Excel: no overlapping matches)
            } else {
                i += 1;
            }
        }

        if positions.is_empty() {
            return if_not_found;
        }

        // Get target instance
        let target_index = if instance_num > 0 {
            (instance_num - 1) as usize
        } else {
            let from_end = (-instance_num) as usize;
            if from_end > positions.len() {
                return if_not_found;
            }
            positions.len() - from_end
        };

        if target_index >= positions.len() {
            return if_not_found;
        }

        let result: String = text_chars[..positions[target_index]].iter().collect();
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnTextAfter;
impl PureFunction for FnTextAfter {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTAFTER"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let delimiter = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let instance_num = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) => n as i64,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };
        let match_mode = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let match_end = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };
        let if_not_found = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                format!("TEXTAFTER: delimiter '{delimiter}' not found in text"),
            )
        };

        if instance_num == 0 {
            return CellValue::error_with_message(
                CellError::Value,
                "TEXTAFTER: instance_num must not be 0",
            );
        }
        if delimiter.is_empty() {
            return if match_end != 0 {
                CellValue::Text(String::new().into())
            } else {
                CellValue::error_with_message(
                    CellError::Value,
                    "TEXTAFTER: delimiter must not be empty",
                )
            };
        }

        // Build char-index positions: find all occurrences using char indices
        let text_chars: Vec<char> = text.chars().collect();
        let delim_chars: Vec<char> = if match_mode == 1 {
            delimiter.to_lowercase().chars().collect()
        } else {
            delimiter.chars().collect()
        };
        let search_chars: Vec<char> = if match_mode == 1 {
            text.to_lowercase().chars().collect()
        } else {
            text_chars.clone()
        };

        let mut positions = Vec::new(); // char-based positions
        let mut i = 0;
        while i + delim_chars.len() <= search_chars.len() {
            if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                positions.push(i);
                i += delim_chars.len(); // advance by delimiter length (Excel: no overlapping matches)
            } else {
                i += 1;
            }
        }

        if positions.is_empty() {
            return if_not_found;
        }

        // Get target instance
        let target_index = if instance_num > 0 {
            (instance_num - 1) as usize
        } else {
            let from_end = (-instance_num) as usize;
            if from_end > positions.len() {
                return if_not_found;
            }
            positions.len() - from_end
        };

        if target_index >= positions.len() {
            return if_not_found;
        }

        let after_pos = positions[target_index] + delim_chars.len();
        let result: String = text_chars[after_pos..].iter().collect();
        CellValue::Text(result.into())
    }
}

pub(crate) struct FnTextSplit;
impl PureFunction for FnTextSplit {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXTSPLIT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };

        // col_delimiter (arg 1) — can be null/empty to skip
        let col_delimiter = if matches!(args[1], CellValue::Null) {
            None
        } else {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_string() {
                Ok(s) if s.is_empty() => None,
                Ok(s) => Some(s.into_owned()),
                Err(e) => return CellValue::Error(e, None),
            }
        };

        // row_delimiter (arg 2) — optional
        let row_delimiter = if args.len() > 2 {
            if matches!(args[2], CellValue::Null) {
                None
            } else {
                if let Some(e) = check_error(&args[2]) {
                    return e;
                }
                match args[2].coerce_to_string() {
                    Ok(s) if s.is_empty() => None,
                    Ok(s) => Some(s.into_owned()),
                    Err(e) => return CellValue::Error(e, None),
                }
            }
        } else {
            None
        };

        // ignore_empty (arg 3)
        let ignore_empty = if args.len() > 3 {
            if let Some(e) = check_error(&args[3]) {
                return e;
            }
            match args[3].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        // match_mode (arg 4): 0=case-sensitive, 1=case-insensitive
        let match_mode = if args.len() > 4 {
            if let Some(e) = check_error(&args[4]) {
                return e;
            }
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        // pad_with (arg 5)
        let pad_with = if args.len() > 5 {
            if let Some(e) = check_error(&args[5]) {
                return e;
            }
            args[5].clone()
        } else {
            CellValue::error_with_message(
                CellError::Na,
                "TEXTSPLIT: row has fewer columns than the widest row",
            )
        };

        // Helper: split a string by delimiter respecting match_mode (char-safe)
        let split_text = |s: &str, delim: &str| -> Vec<String> {
            let s_chars: Vec<char> = s.chars().collect();
            let delim_chars: Vec<char> = if match_mode == 1 {
                delim.to_lowercase().chars().collect()
            } else {
                delim.chars().collect()
            };
            let search_chars: Vec<char> = if match_mode == 1 {
                s.to_lowercase().chars().collect()
            } else {
                s_chars.clone()
            };

            let mut parts = Vec::new();
            let mut last = 0;
            let mut i = 0;
            while i + delim_chars.len() <= search_chars.len() {
                if search_chars[i..i + delim_chars.len()] == delim_chars[..] {
                    parts.push(s_chars[last..i].iter().collect::<String>());
                    last = i + delim_chars.len();
                    i = last;
                } else {
                    i += 1;
                }
            }
            parts.push(s_chars[last..].iter().collect::<String>());
            parts
        };

        // Split by row delimiter first
        let mut rows: Vec<String> = match &row_delimiter {
            Some(rd) => split_text(&text, rd),
            None => vec![text.clone()],
        };

        if ignore_empty {
            rows.retain(|r| !r.is_empty());
        }

        // Split each row by column delimiter
        let col_delim = match &col_delimiter {
            Some(cd) => cd.clone(),
            None => {
                // No column delimiter — return as single column
                let result: Vec<Vec<CellValue>> = rows
                    .iter()
                    .map(|r| vec![CellValue::Text(r.clone().into())])
                    .collect();
                if result.len() == 1 && result[0].len() == 1 {
                    return result[0][0].clone();
                }
                return CellValue::from_rows(result);
            }
        };

        let mut result: Vec<Vec<CellValue>> = Vec::new();
        let mut max_cols = 0;

        for row in &rows {
            let mut cols: Vec<String> = split_text(row, &col_delim);
            if ignore_empty {
                cols.retain(|c| !c.is_empty());
            }
            max_cols = max_cols.max(cols.len());
            let row_vals: Vec<CellValue> = cols
                .into_iter()
                .map(|s| CellValue::Text(s.into()))
                .collect();
            result.push(row_vals);
        }

        // Pad rows to same length
        for row in &mut result {
            while row.len() < max_cols {
                row.push(pad_with.clone());
            }
        }

        // Return 1D if single row
        if result.len() == 1 {
            if result[0].len() == 1 {
                return result[0][0].clone();
            }
            return CellValue::from_rows(result);
        }

        CellValue::from_rows(result)
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnTextBefore));
    registry.register(Box::new(FnTextAfter));
    registry.register(Box::new(FnTextSplit));
}

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{bool_val, err, null, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_textbefore_basic() {
        let f = FnTextBefore;
        assert_eq!(f.call(&[text("hello-world"), text("-")]), text("hello"));
        assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
    }

    #[test]
    fn test_textbefore_instance_num() {
        let f = FnTextBefore;
        // Second instance of "-"
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("a-b"));
        // Negative instance (-1 = last)
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(-1.0)]), text("a-b"));
    }

    #[test]
    fn test_textbefore_case_insensitive() {
        let f = FnTextBefore;
        // match_mode=1 case-insensitive
        assert_eq!(
            f.call(&[text("helloXworld"), text("x"), num(1.0), num(1.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_textafter_basic() {
        let f = FnTextAfter;
        assert_eq!(f.call(&[text("hello-world"), text("-")]), text("world"));
        assert_eq!(f.call(&[text("hello"), text("-")]), err(CellError::Na));
    }

    #[test]
    fn test_textafter_instance_num() {
        let f = FnTextAfter;
        // Second instance of "-"
        assert_eq!(f.call(&[text("a-b-c"), text("-"), num(2.0)]), text("c"));
    }

    #[test]
    fn test_textafter_if_not_found() {
        let f = FnTextAfter;
        // Custom if_not_found
        assert_eq!(
            f.call(&[
                text("hello"),
                text("-"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("N/A")
            ]),
            text("N/A")
        );
    }

    #[test]
    fn test_textsplit_basic() {
        let f = FnTextSplit;
        let result = f.call(&[text("a,b,c"), text(",")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_textsplit_row_and_col() {
        let f = FnTextSplit;
        // "a,b;c,d" split by "," cols and ";" rows
        let result = f.call(&[text("a,b;c,d"), text(","), text(";")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.row(0), &[text("a"), text("b")]);
                assert_eq!(arr.row(1), &[text("c"), text("d")]);
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_textsplit_single_value() {
        let f = FnTextSplit;
        // No delimiter found -> single value
        assert_eq!(f.call(&[text("hello"), text(",")]), text("hello"));
    }

    // -------------------------------------------------------------------
    // Regression tests for UTF-8 / Unicode fixes
    // -------------------------------------------------------------------

    #[test]
    fn test_textbefore_unicode_no_panic() {
        let f = FnTextBefore;
        // Multi-byte delimiter and text: should not panic
        assert_eq!(
            f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
            text("caf\u{00e9}")
        );
        // Emoji delimiter
        assert_eq!(
            f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
            text("hello")
        );
    }

    #[test]
    fn test_textafter_unicode_no_panic() {
        let f = FnTextAfter;
        // Multi-byte delimiter and text: should not panic
        assert_eq!(
            f.call(&[text("caf\u{00e9}\u{2615}test"), text("\u{2615}")]),
            text("test")
        );
        // Emoji delimiter
        assert_eq!(
            f.call(&[text("hello\u{1F600}world"), text("\u{1F600}")]),
            text("world")
        );
    }

    #[test]
    fn test_textbefore_case_insensitive_unicode() {
        let f = FnTextBefore;
        // Case-insensitive with multi-byte chars (German sharp s -> SS)
        assert_eq!(
            f.call(&[
                text("hello\u{00DC}world"),
                text("\u{00fc}"),
                num(1.0),
                num(1.0)
            ]),
            text("hello")
        );
    }

    #[test]
    fn test_textsplit_unicode_no_panic() {
        let f = FnTextSplit;
        // Split on multi-byte delimiter
        let result = f.call(&[text("a\u{2615}b\u{2615}c"), text("\u{2615}")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array"),
        }
    }

    #[test]
    fn test_textbefore_no_overlapping_matches() {
        let f = FnTextBefore;
        // TEXTBEFORE("aaa", "aa", 1) = "" (match at pos 0, text before is empty)
        assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text(""));
        // TEXTBEFORE("aaa", "aa", 2) = #VALUE! (only one non-overlapping match)
        // Returns #N/A because instance not found (if_not_found defaults to #N/A)
        assert_eq!(
            f.call(&[text("aaa"), text("aa"), num(2.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textafter_no_overlapping_matches() {
        let f = FnTextAfter;
        // TEXTAFTER("aaa", "aa", 1) = "a" (match at pos 0, text after "aa" is "a")
        assert_eq!(f.call(&[text("aaa"), text("aa"), num(1.0)]), text("a"));
    }

    // -------------------------------------------------------------------
    // VALUE: parenthetical negatives and currency symbols
    // -------------------------------------------------------------------

    #[test]
    fn test_textbefore_simple() {
        assert_eq!(
            FnTextBefore.call(&[text("hello-world"), text("-")]),
            text("hello")
        );
    }

    #[test]
    fn test_textbefore_not_found_default_na() {
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text("x")]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_instance_2() {
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(2.0)]),
            text("a-b")
        );
    }

    #[test]
    fn test_textbefore_negative_instance_from_end() {
        // -1 means last delimiter occurrence
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-1.0)]),
            text("a-b")
        );
        // -2 means second-to-last
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-2.0)]),
            text("a")
        );
    }

    #[test]
    fn test_textbefore_negative_instance_too_large() {
        // -3 with only 2 occurrences
        assert_eq!(
            FnTextBefore.call(&[text("a-b-c"), text("-"), num(-3.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_instance_zero_error() {
        assert_eq!(
            FnTextBefore.call(&[text("a-b"), text("-"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textbefore_case_insensitive_mode() {
        // match_mode=1 for case-insensitive
        assert_eq!(
            FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
            text("Hello")
        );
    }

    #[test]
    fn test_textbefore_case_sensitive_default() {
        // match_mode=0 (default) is case-sensitive
        assert_eq!(
            FnTextBefore.call(&[text("HelloXworld"), text("x"), num(1.0), num(0.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textbefore_if_not_found_custom() {
        assert_eq!(
            FnTextBefore.call(&[
                text("hello"),
                text("x"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("NOT FOUND")
            ]),
            text("NOT FOUND")
        );
    }

    #[test]
    fn test_textbefore_empty_delimiter_default() {
        // Empty delimiter with match_end=0 => #VALUE!
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text("")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textbefore_empty_delimiter_match_end() {
        // Empty delimiter with match_end=1 => return full text
        assert_eq!(
            FnTextBefore.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
            text("hello")
        );
    }

    #[test]
    fn test_textbefore_delimiter_at_start() {
        // Delimiter at the very start -> empty string before it
        assert_eq!(FnTextBefore.call(&[text("-hello"), text("-")]), text(""));
    }

    #[test]
    fn test_textafter_simple() {
        assert_eq!(
            FnTextAfter.call(&[text("hello-world"), text("-")]),
            text("world")
        );
    }

    #[test]
    fn test_textafter_not_found_default_na() {
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text("x")]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textafter_instance_2() {
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(2.0)]),
            text("c")
        );
    }

    #[test]
    fn test_textafter_negative_instance() {
        // -1 = last delimiter
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(-1.0)]),
            text("c")
        );
        // -2 = second-to-last
        assert_eq!(
            FnTextAfter.call(&[text("a-b-c"), text("-"), num(-2.0)]),
            text("b-c")
        );
    }

    #[test]
    fn test_textafter_instance_zero_error() {
        assert_eq!(
            FnTextAfter.call(&[text("a-b"), text("-"), num(0.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textafter_case_insensitive() {
        assert_eq!(
            FnTextAfter.call(&[text("HelloXworld"), text("x"), num(1.0), num(1.0)]),
            text("world")
        );
    }

    #[test]
    fn test_textafter_empty_delimiter_default() {
        // Empty delimiter with match_end=0 => #VALUE!
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text("")]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_textafter_empty_delimiter_match_end() {
        // Empty delimiter with match_end=1 => empty string
        assert_eq!(
            FnTextAfter.call(&[text("hello"), text(""), num(1.0), num(0.0), num(1.0)]),
            text("")
        );
    }

    #[test]
    fn test_textafter_delimiter_at_end() {
        // Delimiter at the very end -> empty string after it
        assert_eq!(FnTextAfter.call(&[text("hello-"), text("-")]), text(""));
    }

    #[test]
    fn test_textafter_if_not_found_custom() {
        assert_eq!(
            FnTextAfter.call(&[
                text("hello"),
                text("x"),
                num(1.0),
                num(0.0),
                num(0.0),
                text("MISSING")
            ]),
            text("MISSING")
        );
    }

    #[test]
    fn test_textafter_instance_exceeds_count() {
        // Only 1 delimiter but asking for instance 2
        assert_eq!(
            FnTextAfter.call(&[text("a-b"), text("-"), num(2.0)]),
            err(CellError::Na)
        );
    }

    #[test]
    fn test_textsplit_horizontal() {
        let result = FnTextSplit.call(&[text("a,b,c"), text(",")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("c"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_2d_row_and_col() {
        // "a,b;c,d" with col_delim="," row_delim=";"
        let result = FnTextSplit.call(&[text("a,b;c,d"), text(","), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
                assert_eq!(arr.get(1, 1).unwrap(), &text("d"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_no_match_single_value() {
        assert_eq!(FnTextSplit.call(&[text("hello"), text(",")]), text("hello"));
    }

    #[test]
    fn test_textsplit_ignore_empty_true() {
        // "a,,b" with ignore_empty=TRUE should produce {"a","b"}
        let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(true)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_ignore_empty_false() {
        // "a,,b" with ignore_empty=FALSE should produce {"a","","b"}
        let result = FnTextSplit.call(&[text("a,,b"), text(","), null(), bool_val(false)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text(""));
                assert_eq!(arr.get(0, 2).unwrap(), &text("b"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_case_insensitive() {
        // match_mode=1 case-insensitive split
        let result =
            FnTextSplit.call(&[text("aXbxC"), text("x"), null(), bool_val(false), num(1.0)]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("C"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_uneven_rows_padded() {
        // "a,b;c" => row1=[a,b], row2=[c] -> padded with #N/A
        let result = FnTextSplit.call(&[text("a,b;c"), text(","), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("b"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("c"));
                assert_eq!(arr.get(1, 1).unwrap(), &err(CellError::Na));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_only_row_delimiter() {
        // col_delimiter is null, only row_delimiter
        let result = FnTextSplit.call(&[text("a;b;c"), null(), text(";")]);
        match &result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(arr.cols(), 1);
                assert_eq!(arr.get(0, 0).unwrap(), &text("a"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("b"));
                assert_eq!(arr.get(2, 0).unwrap(), &text("c"));
            }
            _ => panic!("Expected array, got {:?}", result),
        }
    }

    #[test]
    fn test_textsplit_error_propagation() {
        assert_eq!(
            FnTextSplit.call(&[err(CellError::Ref), text(",")]),
            err(CellError::Ref)
        );
    }

    // -------------------------------------------------------------------
    // conversion.rs — CHAR, CODE, DOLLAR, FIXED, NUMBERVALUE, etc.
    // -------------------------------------------------------------------
}
