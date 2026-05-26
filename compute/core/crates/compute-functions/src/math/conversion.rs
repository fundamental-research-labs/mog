//! Conversion functions: BASE, DECIMAL, ROMAN, ARABIC

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnBase;
impl PureFunction for FnBase {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "BASE"
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
        let num = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };
        let radix = match args[1].coerce_to_number() {
            Ok(n) => n as u32,
            Err(e) => return CellValue::Error(e, None),
        };
        let min_length = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_number() {
                Ok(n) => n as usize,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        if !(2..=36).contains(&radix) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BASE: radix must be 2-36, got {radix}"),
            );
        }
        if num < 0 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BASE: number must be >= 0, got {num}"),
            );
        }
        if min_length > 255 {
            return CellValue::error_with_message(
                CellError::Num,
                format!("BASE: min_length must be <= 255, got {min_length}"),
            );
        }

        // Convert to base
        let mut result = String::new();
        let mut n = num as u64;
        if n == 0 {
            result.push('0');
        } else {
            while n > 0 {
                let digit = (n % radix as u64) as u32;
                let c = std::char::from_digit(digit, radix).unwrap_or('0');
                result.push(c.to_ascii_uppercase());
                n /= radix as u64;
            }
            result = result.chars().rev().collect();
        }

        // Pad with zeros
        while result.len() < min_length {
            result.insert(0, '0');
        }

        CellValue::Text(result.into())
    }
}

pub(super) struct FnDecimal;
impl PureFunction for FnDecimal {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DECIMAL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let radix = match args[1].coerce_to_number() {
            Ok(n) => n as u32,
            Err(e) => return CellValue::Error(e, None),
        };
        if !(2..=36).contains(&radix) {
            return CellValue::error_with_message(
                CellError::Num,
                format!("DECIMAL: radix must be 2-36, got {radix}"),
            );
        }
        if text.is_empty() {
            return CellValue::error_with_message(
                CellError::Num,
                "DECIMAL: text must not be empty",
            );
        }

        match i64::from_str_radix(&text, radix) {
            Ok(result) => CellValue::number(result as f64),
            Err(_) => CellValue::error_with_message(
                CellError::Num,
                format!("DECIMAL: '{text}' is not valid in base {radix}"),
            ),
        }
    }
}

pub(super) struct FnRoman;
impl PureFunction for FnRoman {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ROMAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let num = match args[0].coerce_to_number() {
            Ok(n) => n as i64,
            Err(e) => return CellValue::Error(e, None),
        };

        // Parse optional form parameter (0=classic, 1-3=concise, 4=most simplified)
        // Also accept TRUE as 0 (classic) and FALSE as 4 (simplified), per Excel
        let form: i64 = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match &args[1] {
                CellValue::Boolean(true) => 0,
                CellValue::Boolean(false) => 4,
                _ => match args[1].coerce_to_number() {
                    Ok(f) => {
                        let form = f as i64;
                        if !(0..=4).contains(&form) {
                            return CellValue::error_with_message(
                                CellError::Value,
                                format!("ROMAN: form must be 0-4, got {form}"),
                            );
                        }
                        form
                    }
                    Err(e) => return CellValue::Error(e, None),
                },
            }
        } else {
            0
        };

        if !(1..=3999).contains(&num) {
            return CellValue::error_with_message(
                CellError::Value,
                format!("ROMAN: number must be 1-3999, got {num}"),
            );
        }

        CellValue::Text(to_roman(num, form).into())
    }
}

/// Convert an integer to Roman numerals with the given form (0-4).
///
/// Form 0: Classic Roman numerals (standard subtractive pairs only)
/// Form 1-4: Progressively more concise subtractive forms
///
/// Each higher form adds additional subtractive combinations:
/// - Form 0: IV(4), IX(9), XL(40), XC(90), CD(400), CM(900)
/// - Form 1: + VL(45), VC(95), LD(450), LM(950)
/// - Form 2: + XD(490), XM(990)
/// - Form 3: + VD(495), VM(995)
/// - Form 4: + ID(499), IM(999)
fn to_roman(num: i64, form: i64) -> String {
    // Build the value table based on form level.
    // Higher forms introduce larger subtractive pairs that allow
    // skipping more levels in subtractive notation.
    let mut values: Vec<(i64, &str)> = Vec::with_capacity(20);

    values.push((1000, "M"));

    if form >= 4 {
        values.push((999, "IM"));
    }
    if form >= 3 {
        values.push((995, "VM"));
    }
    if form >= 2 {
        values.push((990, "XM"));
    }
    if form >= 1 {
        values.push((950, "LM"));
    }
    values.push((900, "CM"));

    values.push((500, "D"));

    if form >= 4 {
        values.push((499, "ID"));
    }
    if form >= 3 {
        values.push((495, "VD"));
    }
    if form >= 2 {
        values.push((490, "XD"));
    }
    if form >= 1 {
        values.push((450, "LD"));
    }
    values.push((400, "CD"));

    values.push((100, "C"));

    if form >= 1 {
        values.push((95, "VC"));
    }
    values.push((90, "XC"));

    values.push((50, "L"));

    if form >= 1 {
        values.push((45, "VL"));
    }
    values.push((40, "XL"));

    values.push((10, "X"));
    values.push((9, "IX"));
    values.push((5, "V"));
    values.push((4, "IV"));
    values.push((1, "I"));

    // Sort by value descending so largest values are consumed first
    values.sort_by(|a, b| b.0.cmp(&a.0));

    let mut result = String::new();
    let mut remaining = num;
    for &(value, numeral) in &values {
        while remaining >= value {
            result.push_str(numeral);
            remaining -= value;
        }
    }
    result
}

pub(super) struct FnArabic;
impl PureFunction for FnArabic {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "ARABIC"
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
            Ok(s) => s.trim().to_uppercase(),
            Err(e) => return CellValue::Error(e, None),
        };
        if text.is_empty() {
            return CellValue::number(0.0);
        }

        let (negative, str_val) = if let Some(stripped) = text.strip_prefix('-') {
            (true, stripped)
        } else {
            (false, text.as_str())
        };

        fn roman_value(c: char) -> Option<i64> {
            match c {
                'I' => Some(1),
                'V' => Some(5),
                'X' => Some(10),
                'L' => Some(50),
                'C' => Some(100),
                'D' => Some(500),
                'M' => Some(1000),
                _ => None,
            }
        }

        let mut result: i64 = 0;
        let mut prev_value: i64 = 0;
        for c in str_val.chars().rev() {
            match roman_value(c) {
                Some(value) => {
                    if value < prev_value {
                        result -= value;
                    } else {
                        result += value;
                    }
                    prev_value = value;
                }
                None => {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!("ARABIC: invalid Roman numeral character '{c}'"),
                    );
                }
            }
        }

        CellValue::number(if negative { -result } else { result } as f64)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnBase));
    registry.register(Box::new(FnDecimal));
    registry.register(Box::new(FnRoman));
    registry.register(Box::new(FnArabic));
}
