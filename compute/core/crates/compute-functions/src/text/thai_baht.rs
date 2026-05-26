//! Excel-compatible BAHTTEXT.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

const TEXT_LIMIT: usize = 32_767;
const MAX_ABS_CENTS: u128 = 99_999_999_999_999_999_999;

pub(crate) struct FnBahtText;

impl PureFunction for FnBahtText {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "BAHTTEXT"
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
        let number = match args[0].coerce_to_number() {
            Ok(n) if n.is_finite() => n,
            Ok(_) => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "BAHTTEXT: non-finite number",
                );
            }
            Err(e) => return CellValue::Error(e, None),
        };

        let abs = number.abs();
        if abs > (MAX_ABS_CENTS as f64 / 100.0) {
            return CellValue::error_with_message(
                CellError::Value,
                "BAHTTEXT: number is too large",
            );
        }

        let cents = (abs.mul_add(100.0, 1e-7)).round() as u128;
        if cents > MAX_ABS_CENTS {
            return CellValue::error_with_message(
                CellError::Value,
                "BAHTTEXT: number is too large",
            );
        }

        let baht = cents / 100;
        let satang = cents % 100;

        let mut result = String::new();
        if number.is_sign_negative() && cents != 0 {
            result.push_str("ลบ");
        }

        if satang == 0 {
            result.push_str(&thai_number(baht));
            result.push_str("บาทถ้วน");
        } else {
            result.push_str(&thai_number(baht));
            result.push_str("บาท");
            result.push_str(&thai_number(satang));
            result.push_str("สตางค์");
        }

        if result.chars().count() > TEXT_LIMIT {
            return CellValue::error_with_message(
                CellError::Value,
                "BAHTTEXT: result exceeds 32767 character limit",
            );
        }
        CellValue::Text(result.into())
    }
}

fn thai_number(n: u128) -> String {
    if n == 0 {
        return "ศูนย์".to_string();
    }
    thai_number_inner(n, false)
}

fn thai_number_inner(n: u128, terminal_one_as_ed: bool) -> String {
    if n >= 1_000_000 {
        let high = n / 1_000_000;
        let low = n % 1_000_000;
        let mut out = thai_number_inner(high, false);
        out.push_str("ล้าน");
        if low != 0 {
            if low == 1 {
                out.push_str("เอ็ด");
            } else {
                out.push_str(&thai_number_inner(low, true));
            }
        }
        out
    } else {
        thai_below_million(n as u32, terminal_one_as_ed)
    }
}

fn thai_below_million(n: u32, terminal_one_as_ed: bool) -> String {
    debug_assert!(n < 1_000_000);
    const DIGITS: [&str; 10] = [
        "ศูนย์",
        "หนึ่ง",
        "สอง",
        "สาม",
        "สี่",
        "ห้า",
        "หก",
        "เจ็ด",
        "แปด",
        "เก้า",
    ];
    const UNITS: [&str; 6] = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

    let mut out = String::new();
    let mut divisor = 100_000;
    for pos in (0..=5).rev() {
        let digit = (n / divisor) % 10;
        if digit != 0 {
            if pos == 1 {
                match digit {
                    1 => {}
                    2 => out.push_str("ยี่"),
                    _ => out.push_str(DIGITS[digit as usize]),
                }
            } else if pos == 0 && digit == 1 && (terminal_one_as_ed || n > 1) {
                out.push_str("เอ็ด");
            } else {
                out.push_str(DIGITS[digit as usize]);
            }
            out.push_str(UNITS[pos as usize]);
        }
        divisor /= 10;
    }
    out
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBahtText));
}

#[cfg(test)]
mod bahttext_golden {
    //! BAHTTEXT parity fixture.
    //!
    //! Provenance: Microsoft documents `BAHTTEXT(1234)` as
    //! `หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน` for Excel. The extended table records
    //! deterministic standard Thai baht output as this engine's compatibility
    //! contract, committed on 2026-05-24 with numeric literals in en-US
    //! formula input format. Large values use the engine's documented
    //! conservative `u128` integer-cent bound when Excel exposes no lower limit.

    use super::*;

    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }

    #[test]
    fn bahttext_golden_values() {
        let cases = [
            (0.0, "ศูนย์บาทถ้วน"),
            (1.0, "หนึ่งบาทถ้วน"),
            (2.0, "สองบาทถ้วน"),
            (10.0, "สิบบาทถ้วน"),
            (11.0, "สิบเอ็ดบาทถ้วน"),
            (21.0, "ยี่สิบเอ็ดบาทถ้วน"),
            (101.0, "หนึ่งร้อยเอ็ดบาทถ้วน"),
            (111.0, "หนึ่งร้อยสิบเอ็ดบาทถ้วน"),
            (1_234.0, "หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน"),
            (1_000_000.0, "หนึ่งล้านบาทถ้วน"),
            (1_000_001.0, "หนึ่งล้านเอ็ดบาทถ้วน"),
            (2_000_000.0, "สองล้านบาทถ้วน"),
            (12_345_678.0, "สิบสองล้านสามแสนสี่หมื่นห้าพันหกร้อยเจ็ดสิบแปดบาทถ้วน"),
            (0.01, "ศูนย์บาทหนึ่งสตางค์"),
            (0.10, "ศูนย์บาทสิบสตางค์"),
            (1.01, "หนึ่งบาทหนึ่งสตางค์"),
            (1.10, "หนึ่งบาทสิบสตางค์"),
            (1.11, "หนึ่งบาทสิบเอ็ดสตางค์"),
            (1.005, "หนึ่งบาทหนึ่งสตางค์"),
            (1.994, "หนึ่งบาทเก้าสิบเก้าสตางค์"),
            (1.995, "สองบาทถ้วน"),
            (999_999.995, "หนึ่งล้านบาทถ้วน"),
            (-1.0, "ลบหนึ่งบาทถ้วน"),
            (-1.25, "ลบหนึ่งบาทยี่สิบห้าสตางค์"),
            (-0.01, "ลบศูนย์บาทหนึ่งสตางค์"),
        ];

        for (input, expected) in cases {
            assert_eq!(
                FnBahtText.call(&[CellValue::number(input)]),
                text(expected),
                "{input}"
            );
        }
    }

    #[test]
    fn bahttext_documented_microsoft_example() {
        assert_eq!(
            FnBahtText.call(&[CellValue::number(1234.0)]),
            text("หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน")
        );
    }

    #[test]
    fn bahttext_coercion_errors_and_bounds() {
        assert_eq!(FnBahtText.call(&[text("2")]), text("สองบาทถ้วน"));
        assert_eq!(
            FnBahtText.call(&[CellValue::Boolean(true)]),
            text("หนึ่งบาทถ้วน")
        );
        assert_eq!(FnBahtText.call(&[CellValue::Null]), text("ศูนย์บาทถ้วน"));
        assert!(matches!(
            FnBahtText.call(&[text("not numeric")]),
            CellValue::Error(CellError::Value, _)
        ));
        assert_eq!(
            FnBahtText.call(&[err(CellError::Div0)]),
            err(CellError::Div0)
        );
        assert!(matches!(
            FnBahtText.call(&[CellValue::number(f64::INFINITY)]),
            CellValue::Error(CellError::Num, _)
        ));
        assert!(matches!(
            FnBahtText.call(&[CellValue::number(1.0e21)]),
            CellValue::Error(CellError::Value, _)
        ));
    }
}
