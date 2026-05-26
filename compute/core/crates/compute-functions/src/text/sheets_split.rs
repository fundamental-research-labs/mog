//! Google Sheets-compatible SPLIT.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

const TEXT_LIMIT: usize = 32_767;

pub(crate) struct FnSplit;

impl PureFunction for FnSplit {
    fn name(&self) -> &'static str {
        "SPLIT"
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
        for arg in args {
            if let Some(e) = check_error(arg) {
                return e;
            }
        }
        for arg in args {
            if matches!(arg, CellValue::Array(_)) {
                return CellValue::error_with_message(
                    CellError::Value,
                    "SPLIT: array arguments are not supported",
                );
            }
        }

        let text = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let delimiter = match args[1].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        let split_by_each = match optional_bool(args.get(2), true) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };
        let remove_empty_text = match optional_bool(args.get(3), true) {
            Ok(v) => v,
            Err(e) => return CellValue::Error(e, None),
        };

        if delimiter.is_empty() {
            return CellValue::error_with_message(CellError::Value, "SPLIT: delimiter is empty");
        }

        let mut parts = if split_by_each {
            split_by_any_char(&text, &delimiter)
        } else {
            split_by_whole_delimiter(&text, &delimiter)
        };

        if remove_empty_text {
            parts.retain(|part| !part.is_empty());
            if parts.is_empty() {
                parts.push(String::new());
            }
        }

        for part in &parts {
            if part.chars().count() > TEXT_LIMIT {
                return CellValue::error_with_message(
                    CellError::Value,
                    "SPLIT: output element exceeds 32767 character limit",
                );
            }
        }

        CellValue::row_array(
            parts
                .into_iter()
                .map(|part| CellValue::Text(part.into()))
                .collect(),
        )
    }
}

fn optional_bool(value: Option<&CellValue>, default: bool) -> Result<bool, CellError> {
    match value {
        None | Some(CellValue::Null) => Ok(default),
        Some(v) => v.coerce_to_bool(),
    }
}

fn split_by_any_char(text: &str, delimiter: &str) -> Vec<String> {
    let delimiters: Vec<char> = delimiter.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if delimiters.contains(&ch) {
            parts.push(std::mem::take(&mut current));
        } else {
            current.push(ch);
        }
    }
    parts.push(current);
    parts
}

fn split_by_whole_delimiter(text: &str, delimiter: &str) -> Vec<String> {
    let text_chars: Vec<char> = text.chars().collect();
    let delim_chars: Vec<char> = delimiter.chars().collect();
    let mut parts = Vec::new();
    let mut last = 0;
    let mut i = 0;
    while i + delim_chars.len() <= text_chars.len() {
        if text_chars[i..i + delim_chars.len()] == delim_chars[..] {
            parts.push(text_chars[last..i].iter().collect());
            i += delim_chars.len();
            last = i;
        } else {
            i += 1;
        }
    }
    parts.push(text_chars[last..].iter().collect());
    parts
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnSplit));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }

    fn row_texts(value: CellValue) -> Vec<String> {
        match value {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 1);
                arr.iter()
                    .map(|v| match v {
                        CellValue::Text(s) => s.to_string(),
                        other => panic!("expected text fragment, got {other:?}"),
                    })
                    .collect()
            }
            other => panic!("expected row array, got {other:?}"),
        }
    }

    #[test]
    fn split_defaults_and_empty_handling() {
        let cases = [
            (vec![text("a,b,c"), text(",")], vec!["a", "b", "c"]),
            (vec![text("a,,b"), text(",")], vec!["a", "b"]),
            (
                vec![text("a,,b"), text(","), bool_val(true), bool_val(false)],
                vec!["a", "", "b"],
            ),
            (vec![text(",a,b,"), text(",")], vec!["a", "b"]),
            (
                vec![text(",a,b,"), text(","), bool_val(true), bool_val(false)],
                vec!["", "a", "b", ""],
            ),
            (vec![text(""), text(",")], vec![""]),
            (vec![text(","), text(",")], vec![""]),
            (
                vec![text(","), text(","), bool_val(true), bool_val(false)],
                vec!["", ""],
            ),
            (vec![text(",,"), text(",")], vec![""]),
            (
                vec![text(",,"), text(","), bool_val(true), bool_val(false)],
                vec!["", "", ""],
            ),
            (vec![text("abc"), text(",")], vec!["abc"]),
        ];

        for (args, expected) in cases {
            assert_eq!(row_texts(FnSplit.call(&args)), expected);
        }
    }

    #[test]
    fn split_by_each_and_whole_delimiter() {
        assert_eq!(
            row_texts(FnSplit.call(&[text("one--two"), text("--"), bool_val(false)])),
            vec!["one", "two"]
        );
        assert_eq!(
            row_texts(FnSplit.call(&[text("one--two"), text("--"), bool_val(true)])),
            vec!["one", "two"]
        );
        assert_eq!(
            row_texts(FnSplit.call(&[text("theater"), text("the")])),
            vec!["a", "r"]
        );
        assert_eq!(
            row_texts(FnSplit.call(&[text("theater"), text("the"), bool_val(false)])),
            vec!["ater"]
        );
    }

    #[test]
    fn split_unicode_and_no_normalization() {
        assert_eq!(
            row_texts(FnSplit.call(&[text("a😀b😀c"), text("😀")])),
            vec!["a", "b", "c"]
        );
        assert_eq!(
            row_texts(FnSplit.call(&[text("cafe\u{0301}|café"), text("\u{0301}")])),
            vec!["cafe", "|café"]
        );
        assert_eq!(
            row_texts(FnSplit.call(&[text("cafe\u{0301}|café"), text("é"), bool_val(false)])),
            vec!["cafe\u{0301}|caf"]
        );
    }

    #[test]
    fn split_numeric_looking_fragments_remain_text() {
        let result = FnSplit.call(&[text("001,1E3,2024-01-01"), text(",")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.cols(), 3);
                assert!(matches!(arr.get(0, 0), Some(CellValue::Text(s)) if s.as_ref() == "001"));
                assert!(matches!(arr.get(0, 1), Some(CellValue::Text(s)) if s.as_ref() == "1E3"));
                assert!(
                    matches!(arr.get(0, 2), Some(CellValue::Text(s)) if s.as_ref() == "2024-01-01")
                );
            }
            other => panic!("expected array, got {other:?}"),
        }
    }

    #[test]
    fn split_option_coercion_errors_and_arrays() {
        assert_eq!(
            row_texts(FnSplit.call(&[text("a,b"), text(","), CellValue::Null, CellValue::Null])),
            vec!["a", "b"]
        );
        assert!(matches!(
            FnSplit.call(&[text("a,b"), text(","), text("nope")]),
            CellValue::Error(CellError::Value, _)
        ));
        assert!(matches!(
            FnSplit.call(&[text("a"), text("")]),
            CellValue::Error(CellError::Value, _)
        ));
        assert!(matches!(
            FnSplit.call(&[CellValue::row_array(vec![text("a")]), text(",")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn split_length_overflow() {
        let long = "a".repeat(32_768);
        assert!(matches!(
            FnSplit.call(&[CellValue::Text(long.into()), text(",")]),
            CellValue::Error(CellError::Value, _)
        ));
    }

    #[test]
    fn split_returns_array_metadata() {
        assert!(FnSplit.returns_array());
        let reg = FunctionRegistry::new();
        assert!(reg.returns_array("SPLIT"));
    }
}
