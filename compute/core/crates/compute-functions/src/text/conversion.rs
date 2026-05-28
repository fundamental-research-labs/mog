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
            CellValue::Image(image) => CellValue::Text(image.fallback_text().into()),
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
                CellValue::Image(image) => image.fallback_text().to_string(),
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

#[cfg(test)]
mod tests {
    use super::super::test_helpers::{bool_val, control, err, null, num, text};
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    #[test]
    fn test_char_code() {
        assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
        assert_eq!(FnCode.call(&[text("A")]), num(65.0));
    }

    #[test]
    fn test_value() {
        let f = FnValue;
        assert_eq!(f.call(&[text("42.5")]), num(42.5));
        assert_eq!(f.call(&[text("hello")]), err(CellError::Value));
        assert_eq!(f.call(&[text("$1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_dollar() {
        let f = FnDollar;
        assert_eq!(f.call(&[num(1234.567)]), text("$1,234.57"));
        assert_eq!(f.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
        assert_eq!(f.call(&[num(0.0)]), text("$0.00"));
    }

    #[test]
    fn test_dollar_negative() {
        let f = FnDollar;
        assert_eq!(f.call(&[num(-1234.56)]), text("($1,234.56)"));
    }

    #[test]
    fn test_fixed() {
        let f = FnFixed;
        assert_eq!(f.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
        assert_eq!(
            f.call(&[num(1234.567), num(2.0), bool_val(true)]),
            text("1234.57")
        );
        assert_eq!(f.call(&[num(1234.0)]), text("1,234.00"));
    }

    #[test]
    fn test_numbervalue() {
        let f = FnNumberValue;
        assert_eq!(f.call(&[text("1,234.56")]), num(1234.56));
        // European format: decimal=comma, group=period
        assert_eq!(
            f.call(&[text("1.234,56"), text(","), text(".")]),
            num(1234.56)
        );
        // Percentage
        assert_eq!(f.call(&[text("50%")]), num(0.5));
        // Empty text -> 0 (Excel behavior)
        assert_eq!(f.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_valuetotext() {
        let f = FnValueToText;
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[text("hello"), num(1.0)]), text("\"hello\""));
        assert_eq!(f.call(&[num(42.0)]), text("42"));
        assert_eq!(f.call(&[bool_val(true)]), text("TRUE"));
        assert_eq!(f.call(&[null()]), text(""));
    }

    #[test]
    fn test_sheets_to_format_conversions_direct_scalar_classes() {
        let inputs = [
            num(12.5),
            text("12.5"),
            bool_val(true),
            null(),
            control(true),
            err(CellError::Div0),
        ];
        for function in [
            &FnToDate as &dyn crate::PureFunction,
            &FnToDollars,
            &FnToPercent,
            &FnToPureNumber,
        ] {
            for input in &inputs {
                assert_eq!(
                    function.call(std::slice::from_ref(input)),
                    input.clone(),
                    "{} should return {:?} unchanged",
                    function.name(),
                    input
                );
            }
        }
    }

    #[test]
    fn test_to_text_direct_scalar_classes() {
        let f = FnToText;
        assert_eq!(f.call(&[num(24.0)]), text("24"));
        assert_eq!(f.call(&[num(12.345678901234567)]), text("12.3456789012346"));
        assert_eq!(f.call(&[text("hello")]), text("hello"));
        assert_eq!(f.call(&[bool_val(false)]), bool_val(false));
        assert_eq!(f.call(&[null()]), null());
        assert_eq!(f.call(&[control(true)]), control(true));
        assert_eq!(f.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_arraytotext_concise() {
        let f = FnArrayToText;
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0), num(3.0)]]);
        assert_eq!(f.call(&[arr, num(0.0)]), text("1, 2, 3"));
    }

    #[test]
    fn test_arraytotext_strict() {
        let f = FnArrayToText;
        // Single-row 2D array: {{1,"hello",3}}
        let arr = CellValue::from_rows(vec![vec![num(1.0), text("hello"), num(3.0)]]);
        assert_eq!(f.call(&[arr, num(1.0)]), text("{{1,\"hello\",3}}"));
        // Multi-row 2D array: {{1,2};{3,4}}
        let arr2 = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        assert_eq!(f.call(&[arr2, num(1.0)]), text("{{1,2};{3,4}}"));
    }

    #[test]
    fn test_arraytotext_single_value() {
        let f = FnArrayToText;
        assert_eq!(f.call(&[num(42.0)]), text("42"));
        assert_eq!(f.call(&[text("hi"), num(1.0)]), text("\"hi\""));
    }

    #[test]
    fn test_numbervalue_empty_returns_zero() {
        let f = FnNumberValue;
        assert_eq!(f.call(&[text("")]), num(0.0));
        assert_eq!(f.call(&[text("  ")]), num(0.0)); // whitespace-only also empty after trim
    }

    // -------------------------------------------------------------------
    // TEXTBEFORE/TEXTAFTER overlapping match (non-overlapping per Excel)
    // -------------------------------------------------------------------

    #[test]
    fn test_value_parenthetical_negative() {
        let f = FnValue;
        assert_eq!(f.call(&[text("(100)")]), num(-100.0));
        assert_eq!(f.call(&[text("($1,234.56)")]), num(-1234.56));
    }

    #[test]
    fn test_value_currency_symbols() {
        let f = FnValue;
        assert_eq!(f.call(&[text("$100")]), num(100.0));
        // Euro symbol
        assert_eq!(f.call(&[text("\u{20AC}100")]), num(100.0));
        // Pound symbol
        assert_eq!(f.call(&[text("\u{00A3}100")]), num(100.0));
        // Yen symbol
        assert_eq!(f.call(&[text("\u{00A5}100")]), num(100.0));
    }

    // -------------------------------------------------------------------
    // TEXT: array-lifting via registry (SUMPRODUCT compatibility)
    // -------------------------------------------------------------------

    #[test]
    fn test_char_uppercase_a() {
        assert_eq!(FnChar.call(&[num(65.0)]), text("A"));
    }

    #[test]
    fn test_char_lowercase_a() {
        assert_eq!(FnChar.call(&[num(97.0)]), text("a"));
    }

    #[test]
    fn test_char_newline() {
        assert_eq!(FnChar.call(&[num(10.0)]), text("\n"));
    }

    #[test]
    fn test_char_space() {
        assert_eq!(FnChar.call(&[num(32.0)]), text(" "));
    }

    #[test]
    fn test_char_out_of_range_zero() {
        assert_eq!(FnChar.call(&[num(0.0)]), err(CellError::Value));
    }

    #[test]
    fn test_char_out_of_range_256() {
        assert_eq!(FnChar.call(&[num(256.0)]), err(CellError::Value));
    }

    #[test]
    fn test_char_boundary_255() {
        // Code 255 should work (max valid)
        let result = FnChar.call(&[num(255.0)]);
        assert!(matches!(result, CellValue::Text(_)));
    }

    #[test]
    fn test_char_boundary_1() {
        // Code 1 should work (min valid)
        let result = FnChar.call(&[num(1.0)]);
        assert!(matches!(result, CellValue::Text(_)));
    }

    #[test]
    fn test_code_uppercase_a() {
        assert_eq!(FnCode.call(&[text("A")]), num(65.0));
    }

    #[test]
    fn test_code_lowercase_a() {
        assert_eq!(FnCode.call(&[text("a")]), num(97.0));
    }

    #[test]
    fn test_code_takes_first_char() {
        // CODE only looks at the first character
        assert_eq!(FnCode.call(&[text("ABC")]), num(65.0));
    }

    #[test]
    fn test_code_empty_string_error() {
        assert_eq!(FnCode.call(&[text("")]), err(CellError::Value));
    }

    #[test]
    fn test_code_unicode_char() {
        // Euro sign U+20AC = 8364
        assert_eq!(FnCode.call(&[text("\u{20AC}")]), num(8364.0));
    }

    #[test]
    fn test_dollar_default_2_decimals() {
        assert_eq!(FnDollar.call(&[num(1234.567)]), text("$1,234.57"));
    }

    #[test]
    fn test_dollar_1_decimal() {
        assert_eq!(FnDollar.call(&[num(1234.567), num(1.0)]), text("$1,234.6"));
    }

    #[test]
    fn test_dollar_0_decimals() {
        assert_eq!(FnDollar.call(&[num(1234.567), num(0.0)]), text("$1,235"));
    }

    #[test]
    fn test_dollar_negative_value() {
        assert_eq!(FnDollar.call(&[num(-1234.56)]), text("($1,234.56)"));
    }

    #[test]
    fn test_dollar_zero() {
        assert_eq!(FnDollar.call(&[num(0.0)]), text("$0.00"));
    }

    #[test]
    fn test_dollar_error_propagation() {
        assert_eq!(FnDollar.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_fixed_default_2_decimals_with_commas() {
        // FIXED(1234.567) defaults to 2 decimals with commas
        assert_eq!(FnFixed.call(&[num(1234.567)]), text("1,234.57"));
    }

    #[test]
    fn test_fixed_2_decimals_with_commas() {
        assert_eq!(FnFixed.call(&[num(1234.567), num(2.0)]), text("1,234.57"));
    }

    #[test]
    fn test_fixed_2_decimals_no_commas() {
        assert_eq!(
            FnFixed.call(&[num(1234.567), num(2.0), bool_val(true)]),
            text("1234.57")
        );
    }

    #[test]
    fn test_fixed_0_decimals() {
        assert_eq!(FnFixed.call(&[num(1234.567), num(0.0)]), text("1,235"));
    }

    #[test]
    fn test_fixed_negative_value() {
        assert_eq!(FnFixed.call(&[num(-1234.56), num(2.0)]), text("-1,234.56"));
    }

    #[test]
    fn test_fixed_error_propagation() {
        assert_eq!(FnFixed.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    #[test]
    fn test_numbervalue_standard() {
        assert_eq!(FnNumberValue.call(&[text("1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_numbervalue_european_format() {
        assert_eq!(
            FnNumberValue.call(&[text("1.234,56"), text(","), text(".")]),
            num(1234.56)
        );
    }

    #[test]
    fn test_numbervalue_percentage() {
        assert_eq!(FnNumberValue.call(&[text("50%")]), num(0.5));
    }

    #[test]
    fn test_numbervalue_empty_is_zero() {
        assert_eq!(FnNumberValue.call(&[text("")]), num(0.0));
    }

    #[test]
    fn test_numbervalue_whitespace_is_zero() {
        assert_eq!(FnNumberValue.call(&[text("   ")]), num(0.0));
    }

    #[test]
    fn test_numbervalue_invalid_text() {
        assert_eq!(FnNumberValue.call(&[text("abc")]), err(CellError::Value));
    }

    #[test]
    fn test_numbervalue_currency_stripped() {
        assert_eq!(FnNumberValue.call(&[text("$100")]), num(100.0));
        assert_eq!(FnNumberValue.call(&[text("\u{20AC}100")]), num(100.0));
    }

    #[test]
    fn test_valuetotext_number() {
        assert_eq!(FnValueToText.call(&[num(123.0)]), text("123"));
    }

    #[test]
    fn test_valuetotext_boolean() {
        assert_eq!(FnValueToText.call(&[bool_val(true)]), text("TRUE"));
        assert_eq!(FnValueToText.call(&[bool_val(false)]), text("FALSE"));
    }

    #[test]
    fn test_valuetotext_text_concise() {
        assert_eq!(FnValueToText.call(&[text("hello")]), text("hello"));
    }

    #[test]
    fn test_valuetotext_text_strict() {
        assert_eq!(
            FnValueToText.call(&[text("hello"), num(1.0)]),
            text("\"hello\"")
        );
    }

    #[test]
    fn test_valuetotext_null() {
        assert_eq!(FnValueToText.call(&[null()]), text(""));
    }

    #[test]
    fn test_valuetotext_invalid_format() {
        assert_eq!(
            FnValueToText.call(&[text("x"), num(2.0)]),
            err(CellError::Value)
        );
    }

    #[test]
    fn test_arraytotext_concise_multirow() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("1, 2; 3, 4"));
    }

    #[test]
    fn test_arraytotext_strict_with_text() {
        let arr = CellValue::from_rows(vec![vec![text("hi"), num(1.0)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(1.0)]), text("{{\"hi\",1}}"));
    }

    #[test]
    fn test_arraytotext_boolean_value() {
        let arr = CellValue::from_rows(vec![vec![bool_val(true), bool_val(false)]]);
        assert_eq!(FnArrayToText.call(&[arr, num(0.0)]), text("TRUE, FALSE"));
    }

    #[test]
    fn test_value_numeric_string() {
        assert_eq!(FnValue.call(&[text("42.5")]), num(42.5));
    }

    #[test]
    fn test_value_non_numeric_error() {
        assert_eq!(FnValue.call(&[text("hello")]), err(CellError::Value));
    }

    #[test]
    fn test_value_currency() {
        assert_eq!(FnValue.call(&[text("$1,234.56")]), num(1234.56));
    }

    #[test]
    fn test_value_percentage() {
        assert_eq!(FnValue.call(&[text("50%")]), num(0.5));
    }

    #[test]
    fn test_value_empty_string_error() {
        assert_eq!(FnValue.call(&[text("")]), err(CellError::Value));
    }

    #[test]
    fn test_value_number_passthrough() {
        assert_eq!(FnValue.call(&[num(42.0)]), num(42.0));
    }

    #[test]
    fn test_value_boolean_coercion() {
        assert_eq!(FnValue.call(&[bool_val(true)]), num(1.0));
        assert_eq!(FnValue.call(&[bool_val(false)]), num(0.0));
    }

    #[test]
    fn test_value_parens_negative_number() {
        assert_eq!(FnValue.call(&[text("(100)")]), num(-100.0));
    }

    // -------------------------------------------------------------------
    // joining.rs — CONCATENATE, CONCAT, TEXTJOIN, REPT, EXACT
    // -------------------------------------------------------------------

    #[test]
    fn test_sheets_to_conversion_registry_array_lift() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![num(1.0), text("x")],
            vec![bool_val(true), null()],
        ]);

        for name in ["TO_DATE", "TO_DOLLARS", "TO_PERCENT", "TO_PURE_NUMBER"] {
            assert_eq!(reg.call(name, std::slice::from_ref(&arr)), arr);
        }

        assert_eq!(
            reg.call("TO_TEXT", &[arr]),
            CellValue::from_rows(vec![
                vec![text("1"), text("x")],
                vec![bool_val(true), null()]
            ])
        );
    }

    #[test]
    fn test_text_array_numbers() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(1.5), num(2.7), num(3.1)]]);
        let result = reg.call("TEXT", &[arr, text("0.0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("1.5"));
                assert_eq!(arr.get(0, 1).unwrap(), &text("2.7"));
                assert_eq!(arr.get(0, 2).unwrap(), &text("3.1"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_dates() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(44562.0)], vec![num(44593.0)]]);
        let result = reg.call("TEXT", &[arr, text("mmm-yy")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("Jan-22"));
                assert_eq!(arr.get(1, 0).unwrap(), &text("Feb-22"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_with_errors() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![
            num(1.0),
            CellValue::Error(CellError::Div0, None),
            num(3.0),
        ]]);
        let result = reg.call("TEXT", &[arr, text("0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
                assert_eq!(arr.get(0, 1).unwrap(), &err(CellError::Div0));
                assert_eq!(arr.get(0, 2).unwrap(), &text("3"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_array_preserves_2d_shape() {
        let reg = crate::FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]);
        let result = reg.call("TEXT", &[arr, text("0")]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 2);
                assert_eq!(arr.cols(), 2);
                assert_eq!(arr.get(0, 0).unwrap(), &text("1"));
                assert_eq!(arr.get(1, 1).unwrap(), &text("4"));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_scalar_unchanged() {
        let f = FnText;
        assert_eq!(f.call(&[num(0.5), text("0%")]), text("50%"));
    }

    // --- Bulk text function array tests ---

    #[test]
    fn test_text_format_number() {
        assert_eq!(FnText.call(&[num(0.5), text("0%")]), text("50%"));
    }

    #[test]
    fn test_text_at_sign_format() {
        assert_eq!(FnText.call(&[num(1234.5), text("@")]), text("1234.5"));
        assert_eq!(FnText.call(&[text("hello"), text("@")]), text("hello"));
        assert_eq!(FnText.call(&[bool_val(true), text("@")]), text("TRUE"));
        assert_eq!(FnText.call(&[null(), text("@")]), text(""));
    }
}
