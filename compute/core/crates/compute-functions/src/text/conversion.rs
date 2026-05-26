//! Conversion functions: TEXT, VALUE, CHAR, CODE, FIXED, DOLLAR, NUMBERVALUE,
//! VALUETOTEXT, ARRAYTOTEXT, TO_DATE, TO_DOLLARS, TO_PERCENT, TO_PURE_NUMBER,
//! TO_TEXT

use value_types::date_serial::{try_parse_date, try_parse_datetime, try_parse_time};
use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnText;
impl PureFunction for FnText {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TEXT"
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
        let format_code = match args[1].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };

        // Fast path: "@" format = text identity / number-to-string
        if format_code == "@" {
            return match &args[0] {
                CellValue::Text(t) => CellValue::Text(t.clone()),
                CellValue::Number(n) => {
                    // Excel: TEXT(1234.5, "@") → "1234.5" (no locale formatting)
                    // Use format_number which truncates to 15 significant digits,
                    // matching Excel's number-to-text coercion behavior.
                    CellValue::Text(value_types::format_number(n.get()).into())
                }
                CellValue::Boolean(b) => CellValue::Text(if *b { "TRUE" } else { "FALSE" }.into()),
                CellValue::Null => CellValue::Text("".into()),
                CellValue::Error(e, _) => CellValue::Error(*e, None),
                _ => CellValue::Text(args[0].coerce_to_string().unwrap_or_default().into()),
            };
        }

        // If the value is text, try to interpret it as a number or date first
        // (Excel coerces text to numbers/dates via implicit DATEVALUE/VALUE)
        if let CellValue::Text(ref t) = args[0] {
            let trimmed = t.trim();
            // Quick prefix check: only attempt numeric/date coercion if the first
            // character could plausibly start a number or date string. This avoids
            // 4 failed parse attempts for genuine text values.
            let first = trimmed.as_bytes().first().copied().unwrap_or(0);
            let could_be_numeric = first.is_ascii_digit()
                || first == b'-'
                || first == b'+'
                || first == b'('
                || first == b'.';
            if could_be_numeric {
                // Try to interpret text as a number first (Excel coerces text-numbers)
                if let Ok(n) = trimmed.parse::<f64>() {
                    return CellValue::Text(compute_formats::format_number(n, &format_code).into());
                }
                // Try to interpret text as a date string (Excel does implicit DATEVALUE)
                if let Ok(serial) = try_parse_date(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(serial, &format_code).into(),
                    );
                }
                // Try to interpret text as a datetime string (e.g. "1/1/2025 10:30:00")
                if let Ok(serial) = try_parse_datetime(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(serial, &format_code).into(),
                    );
                }
                // Try to interpret text as a time string
                if let Ok(time_val) = try_parse_time(trimmed) {
                    return CellValue::Text(
                        compute_formats::format_number(time_val, &format_code).into(),
                    );
                }
            }
            // Fall back to text formatting (@ placeholder, multi-section formats)
            return CellValue::Text(compute_formats::format_text(t, &format_code).into());
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                // Excel returns #VALUE! for negative serials with date/time format codes
                if n < 0.0 && compute_formats::is_date_format(&format_code) {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "TEXT: negative number {n} cannot be formatted with date/time format code"
                        ),
                    );
                }
                CellValue::Text(compute_formats::format_number(n, &format_code).into())
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnValue;
impl PureFunction for FnValue {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "VALUE"
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
        match &args[0] {
            CellValue::Number(n) => CellValue::Number(*n),
            CellValue::Boolean(b) => CellValue::number(if *b { 1.0 } else { 0.0 }),
            CellValue::Text(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    return CellValue::error_with_message(
                        CellError::Value,
                        "VALUE: cannot convert empty string to a number",
                    );
                }

                // Check for parenthetical negative: "(..." and "...)"
                let (working, is_negative) = if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    (&trimmed[1..trimmed.len() - 1], true)
                } else {
                    (trimmed, false)
                };

                // Strip currency symbols ($, €, £, ¥) and thousands separators (,)
                let has_percent = working.contains('%');
                let cleaned =
                    working.replace([',', '$', '\u{20AC}', '\u{00A3}', '\u{00A5}', '%'], "");
                match fast_float::parse::<f64, _>(cleaned.trim()) {
                    Ok(n) => {
                        let mut result = n;
                        if has_percent {
                            result /= 100.0;
                        }
                        if is_negative {
                            result = -result;
                        }
                        CellValue::number(result)
                    }
                    Err(_) => {
                        // Numeric parsing failed; try date parsing
                        if let Ok(serial) = try_parse_date(trimmed) {
                            return CellValue::number(serial);
                        }
                        // Try time parsing
                        if let Ok(frac) = try_parse_time(trimmed) {
                            return CellValue::number(frac);
                        }
                        CellValue::error_with_message(
                            CellError::Value,
                            format!("VALUE: cannot convert '{trimmed}' to a number"),
                        )
                    }
                }
            }
            _ => CellValue::error_with_message(CellError::Value, "VALUE: argument must be text"),
        }
    }
}

pub(crate) struct FnChar;
impl PureFunction for FnChar {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CHAR"
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
        match args[0].coerce_to_number() {
            Ok(n) => {
                let code = n as u32;
                if !(1..=255).contains(&code) {
                    CellValue::error_with_message(
                        CellError::Value,
                        format!("CHAR: code {code} out of range, must be 1-255"),
                    )
                } else {
                    // Excel on Mac uses Mac OS Roman encoding for CHAR (codes 128-255 differ from Unicode)
                    let ch = mac_roman_to_char(code as u8);
                    CellValue::Text(ch.to_string().into())
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

/// Map a Mac OS Roman byte to a Unicode character.
/// Codes 0-127 map directly to ASCII/Unicode code points.
/// Codes 128-255 use the Mac OS Roman encoding table.
fn mac_roman_to_char(code: u8) -> char {
    // Mac OS Roman encoding for bytes 128-255
    static MAC_ROMAN: [u16; 128] = [
        // 128-143
        0x00C4, 0x00C5, 0x00C7, 0x00C9, 0x00D1, 0x00D6, 0x00DC, 0x00E1, 0x00E0, 0x00E2, 0x00E4,
        0x00E3, 0x00E5, 0x00E7, 0x00E9, 0x00E8, // 144-159
        0x00EA, 0x00EB, 0x00ED, 0x00EC, 0x00EE, 0x00EF, 0x00F1, 0x00F3, 0x00F2, 0x00F4, 0x00F6,
        0x00F5, 0x00FA, 0x00F9, 0x00FB, 0x00FC, // 160-175
        0x2020, 0x00B0, 0x00A2, 0x00A3, 0x00A7, 0x2022, 0x00B6, 0x00DF, 0x00AE, 0x00A9, 0x2122,
        0x00B4, 0x00A8, 0x2260, 0x00C6, 0x00D8, // 176-191
        0x221E, 0x00B1, 0x2264, 0x2265, 0x00A5, 0x00B5, 0x2202, 0x2211, 0x220F, 0x03C0, 0x222B,
        0x00AA, 0x00BA, 0x03A9, 0x00E6, 0x00F8, // 192-207
        0x00BF, 0x00A1, 0x00AC, 0x221A, 0x0192, 0x2248, 0x2206, 0x00AB, 0x00BB, 0x2026, 0x00A0,
        0x00C0, 0x00C3, 0x00D5, 0x0152, 0x0153, // 208-223
        0x2013, 0x2014, 0x201C, 0x201D, 0x2018, 0x2019, 0x00F7, 0x25CA, 0x00FF, 0x0178, 0x2044,
        0x20AC, 0x2039, 0x203A, 0xFB01, 0xFB02, // 224-239
        0x2021, 0x00B7, 0x201A, 0x201E, 0x2030, 0x00C2, 0x00CA, 0x00C1, 0x00CB, 0x00C8, 0x00CD,
        0x00CE, 0x00CF, 0x00CC, 0x00D3, 0x00D4, // 240-255
        0xF8FF, 0x00D2, 0x00DA, 0x00DB, 0x00D9, 0x0131, 0x02C6, 0x02DC, 0x00AF, 0x02D8, 0x02D9,
        0x02DA, 0x00B8, 0x02DD, 0x02DB, 0x02C7,
    ];
    if code < 128 {
        char::from_u32(code as u32).unwrap_or('?')
    } else {
        char::from_u32(MAC_ROMAN[(code - 128) as usize] as u32).unwrap_or('?')
    }
}

pub(crate) struct FnCode;
impl PureFunction for FnCode {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "CODE"
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
        match args[0].coerce_to_string() {
            Ok(s) if s.is_empty() => {
                CellValue::error_with_message(CellError::Value, "CODE: text must not be empty")
            }
            Ok(s) => {
                let c = match s.chars().next() {
                    Some(c) => c,
                    None => return CellValue::Error(CellError::Value, None),
                };
                CellValue::number(c as u32 as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(crate) struct FnDollar;
impl PureFunction for FnDollar {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DOLLAR"
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
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimals = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            2
        };

        CellValue::Text(compute_formats::format_dollar(number, decimals).into())
    }
}

pub(crate) struct FnFixed;
impl PureFunction for FnFixed {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FIXED"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let number = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimals = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(d) => d as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            2
        };
        let no_commas = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_bool() {
                Ok(b) => b,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            false
        };

        CellValue::Text(compute_formats::format_fixed(number, decimals, no_commas).into())
    }
}

pub(crate) struct FnNumberValue;
impl PureFunction for FnNumberValue {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "NUMBERVALUE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let text = match args[0].coerce_to_string() {
            Ok(s) => s,
            Err(e) => return CellValue::Error(e, None),
        };
        let decimal_sep = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_string() {
                Ok(s) => s.into_owned(),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            ".".to_string()
        };
        let group_sep = if args.len() > 2 {
            if let Some(e) = check_error(&args[2]) {
                return e;
            }
            match args[2].coerce_to_string() {
                Ok(s) => s.into_owned(),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            ",".to_string()
        };

        let trimmed = text.trim();
        if trimmed.is_empty() {
            return CellValue::number(0.0);
        }

        let mut cleaned = trimmed.to_string();

        // Handle percentage
        let is_percent = cleaned.ends_with('%');
        if is_percent {
            cleaned = cleaned[..cleaned.len() - 1].trim().to_string();
        }

        // Remove group separators
        if !group_sep.is_empty() {
            cleaned = cleaned.replace(&group_sep, "");
        }

        // Replace decimal separator with standard period
        if !decimal_sep.is_empty() && decimal_sep != "." {
            cleaned = cleaned.replace(&decimal_sep, ".");
        }

        // Remove currency symbols and spaces
        cleaned = cleaned.replace(['$', '\u{20AC}', '\u{00A3}', '\u{00A5}', ' '], "");

        match fast_float::parse::<f64, _>(cleaned.trim()) {
            Ok(n) => {
                if is_percent {
                    CellValue::number(n / 100.0)
                } else {
                    CellValue::number(n)
                }
            }
            Err(_) => CellValue::error_with_message(
                CellError::Value,
                format!("NUMBERVALUE: cannot convert '{trimmed}' to a number"),
            ),
        }
    }
}

pub(crate) struct FnValueToText;
impl PureFunction for FnValueToText {
    fn name(&self) -> &'static str {
        "VALUETOTEXT"
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
        let format = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(f) => {
                    let f = f as i32;
                    if f != 0 && f != 1 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!("VALUETOTEXT: format must be 0 or 1, got {f}"),
                        );
                    }
                    f
                }
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        match &args[0] {
            CellValue::Null => CellValue::Text(String::new().into()),
            CellValue::Boolean(b) => CellValue::Text(if *b {
                "TRUE".to_string().into()
            } else {
                "FALSE".to_string().into()
            }),
            CellValue::Control(c) => CellValue::Text(if c.value {
                "TRUE".to_string().into()
            } else {
                "FALSE".to_string().into()
            }),
            CellValue::Number(_) => CellValue::Text(
                args[0]
                    .coerce_to_string()
                    .unwrap_or_default()
                    .into_owned()
                    .into(),
            ),
            CellValue::Text(s) => {
                if format == 1 {
                    // Strict format: wrap text in quotes
                    CellValue::Text(format!("\"{}\"", s).into())
                } else {
                    CellValue::Text(s.clone())
                }
            }
            CellValue::Array(arr) => {
                // Convert array to text representation
                let mut parts = Vec::new();
                for row in arr.rows_iter() {
                    let row_parts: Vec<String> = row
                        .iter()
                        .map(|v| match v.coerce_to_string() {
                            Ok(s) => {
                                if format == 1 {
                                    if matches!(v, CellValue::Text(_)) {
                                        format!("\"{}\"", s)
                                    } else {
                                        s.into_owned()
                                    }
                                } else {
                                    s.into_owned()
                                }
                            }
                            Err(_) => String::new(),
                        })
                        .collect();
                    parts.push(row_parts.join(","));
                }
                if format == 1 {
                    CellValue::Text(format!("{{{}}}", parts.join(";")).into())
                } else {
                    CellValue::Text(parts.join(", ").into())
                }
            }
            CellValue::Error(e, _) => CellValue::Error(*e, None),
        }
    }
}

pub(crate) struct FnArrayToText;
impl PureFunction for FnArrayToText {
    fn name(&self) -> &'static str {
        "ARRAYTOTEXT"
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
        let format = if args.len() > 1 {
            if let Some(e) = check_error(&args[1]) {
                return e;
            }
            match args[1].coerce_to_number() {
                Ok(f) => {
                    let f = f as i32;
                    if f != 0 && f != 1 {
                        return CellValue::error_with_message(
                            CellError::Value,
                            format!("ARRAYTOTEXT: format must be 0 or 1, got {f}"),
                        );
                    }
                    f
                }
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let strict = format == 1;

        // Helper: convert a single value to its text representation
        fn value_to_text(v: &CellValue, strict: bool) -> String {
            match v {
                CellValue::Null => String::new(),
                CellValue::Boolean(b) => {
                    if *b {
                        "TRUE".to_string()
                    } else {
                        "FALSE".to_string()
                    }
                }
                CellValue::Number(_) => v.coerce_to_string().unwrap_or_default().into_owned(),
                CellValue::Text(s) => {
                    if strict {
                        format!("\"{}\"", s)
                    } else {
                        s.to_string()
                    }
                }
                CellValue::Error(e, _) => e.as_str().to_string(),
                CellValue::Control(c) => if c.value { "TRUE" } else { "FALSE" }.to_string(),
                CellValue::Array(_) => String::new(),
            }
        }

        match &args[0] {
            CellValue::Array(arr) => {
                let row_strs: Vec<String> = arr
                    .rows_iter()
                    .map(|row| {
                        let cell_strs: Vec<String> =
                            row.iter().map(|v| value_to_text(v, strict)).collect();
                        if strict {
                            cell_strs.join(",")
                        } else {
                            cell_strs.join(", ")
                        }
                    })
                    .collect();
                if strict {
                    let inner = row_strs
                        .iter()
                        .map(|r| format!("{{{}}}", r))
                        .collect::<Vec<_>>()
                        .join(";");
                    CellValue::Text(format!("{{{}}}", inner).into())
                } else {
                    CellValue::Text(row_strs.join("; ").into())
                }
            }
            other => {
                // Single value
                CellValue::Text(value_to_text(other, strict).into())
            }
        }
    }
}

fn passthrough_numeric_format_conversion(args: &[CellValue]) -> CellValue {
    match &args[0] {
        CellValue::Number(n) => CellValue::Number(*n),
        other => other.clone(),
    }
}

pub(crate) struct FnToDate;
impl PureFunction for FnToDate {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_DATE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(crate) struct FnToDollars;
impl PureFunction for FnToDollars {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_DOLLARS"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(crate) struct FnToPercent;
impl PureFunction for FnToPercent {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_PERCENT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(crate) struct FnToPureNumber;
impl PureFunction for FnToPureNumber {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_PURE_NUMBER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        passthrough_numeric_format_conversion(args)
    }
}

pub(crate) struct FnToText;
impl PureFunction for FnToText {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "TO_TEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Number(n) => CellValue::Text(value_types::format_number(n.get()).into()),
            other => other.clone(),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnText));
    registry.register(Box::new(FnValue));
    registry.register(Box::new(FnChar));
    registry.register(Box::new(FnCode));
    registry.register(Box::new(FnDollar));
    registry.register(Box::new(FnFixed));
    registry.register(Box::new(FnNumberValue));
    registry.register(Box::new(FnValueToText));
    registry.register(Box::new(FnArrayToText));
    registry.register(Box::new(FnToDate));
    registry.register(Box::new(FnToDollars));
    registry.register(Box::new(FnToPercent));
    registry.register(Box::new(FnToPureNumber));
    registry.register(Box::new(FnToText));
}
