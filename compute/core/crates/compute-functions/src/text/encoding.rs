//! Text encoding functions: ENCODEURL

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

const TEXT_LIMIT: usize = 32_767;

pub(crate) struct FnEncodeUrl;

impl PureFunction for FnEncodeUrl {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "ENCODEURL"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };

        let mut encoded = String::with_capacity(text.len());
        for byte in text.as_bytes() {
            match *byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(char::from(*byte));
                }
                _ => {
                    use std::fmt::Write as _;
                    write!(&mut encoded, "%{byte:02X}").expect("writing to String cannot fail");
                }
            }
        }

        if encoded.chars().count() > TEXT_LIMIT {
            return CellValue::error_with_message(
                CellError::Value,
                "ENCODEURL: result exceeds 32767 character limit",
            );
        }
        CellValue::Text(encoded.into())
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnEncodeUrl));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    #[test]
    fn encodeurl_truth_table() {
        let cases = [
            ("hello, world!", "hello%2C%20world%21"),
            (
                "a b+c&d=e#f/g?x:y;z",
                "a%20b%2Bc%26d%3De%23f%2Fg%3Fx%3Ay%3Bz",
            ),
            ("AZaz09-_.~", "AZaz09-_.~"),
            ("%20", "%2520"),
            ("line\nbreak\tend", "line%0Abreak%09end"),
            ("😀", "%F0%9F%98%80"),
            ("ไทย", "%E0%B9%84%E0%B8%97%E0%B8%A2"),
            ("", ""),
        ];
        for (input, expected) in cases {
            assert_eq!(
                FnEncodeUrl.call(&[text(input)]),
                text(expected),
                "{input:?}"
            );
        }
    }

    #[test]
    fn encodeurl_coercion_and_errors() {
        assert_eq!(FnEncodeUrl.call(&[CellValue::number(12.0)]), text("12"));
        assert_eq!(FnEncodeUrl.call(&[CellValue::Boolean(true)]), text("TRUE"));
        assert_eq!(FnEncodeUrl.call(&[CellValue::Null]), text(""));
        assert_eq!(FnEncodeUrl.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn encodeurl_length_overflow() {
        let input = " ".repeat(10_923);
        assert!(matches!(
            FnEncodeUrl.call(&[CellValue::Text(input.into())]),
            CellValue::Error(CellError::Value, _)
        ));
    }
}
