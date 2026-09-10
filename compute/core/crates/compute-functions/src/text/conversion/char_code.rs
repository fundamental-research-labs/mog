//! Legacy single-byte code-page functions.
//!
//! Excel's CHAR and CODE functions are deliberately different from UNICHAR
//! and UNICODE. They use the workbook's selected legacy character set, not a
//! Unicode scalar value. The evaluator supplies that selection through
//! [`FunctionContext`](crate::FunctionContext); no runtime-host code page is
//! consulted here.

use value_types::{CellError, CellValue};

use crate::helpers::coercion::check_error;
use crate::{CharCodePage, FunctionContext, FunctionRegistry, PureFunction};

/// The Windows-1252 mappings for bytes 0x80..0xFF.
///
/// The five historically undefined Windows-1252 slots are represented by
/// their corresponding C1 control characters. This gives each byte a stable
/// Unicode representation and agrees with the byte-to-Unicode table published
/// for Windows-1252.
const WINDOWS_1252_HIGH: [u32; 128] = [
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039,
    0x0152, 0x008D, 0x017D, 0x008F, 0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178, 0x00A0, 0x00A1, 0x00A2, 0x00A3,
    0x00A4, 0x00A5, 0x00A6, 0x00A7, 0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF,
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, 0x00B8, 0x00B9, 0x00BA, 0x00BB,
    0x00BC, 0x00BD, 0x00BE, 0x00BF, 0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7,
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, 0x00D0, 0x00D1, 0x00D2, 0x00D3,
    0x00D4, 0x00D5, 0x00D6, 0x00D7, 0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF,
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, 0x00E8, 0x00E9, 0x00EA, 0x00EB,
    0x00EC, 0x00ED, 0x00EE, 0x00EF, 0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7,
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF,
];

/// The Macintosh Roman mappings for bytes 0x80..0xFF.
const MACINTOSH_ROMAN_HIGH: [u32; 128] = [
    0x00C4, 0x00C5, 0x00C7, 0x00C9, 0x00D1, 0x00D6, 0x00DC, 0x00E1, 0x00E0, 0x00E2, 0x00E4, 0x00E3,
    0x00E5, 0x00E7, 0x00E9, 0x00E8, 0x00EA, 0x00EB, 0x00ED, 0x00EC, 0x00EE, 0x00EF, 0x00F1, 0x00F3,
    0x00F2, 0x00F4, 0x00F6, 0x00F5, 0x00FA, 0x00F9, 0x00FB, 0x00FC, 0x2020, 0x00B0, 0x00A2, 0x00A3,
    0x00A7, 0x2022, 0x00B6, 0x00DF, 0x00AE, 0x00A9, 0x2122, 0x00B4, 0x00A8, 0x2260, 0x00C6, 0x00D8,
    0x221E, 0x00B1, 0x2264, 0x2265, 0x00A5, 0x00B5, 0x2202, 0x2211, 0x220F, 0x03C0, 0x222B, 0x00AA,
    0x00BA, 0x03A9, 0x00E6, 0x00F8, 0x00BF, 0x00A1, 0x00AC, 0x221A, 0x0192, 0x2248, 0x2206, 0x00AB,
    0x00BB, 0x2026, 0x00A0, 0x00C0, 0x00C3, 0x00D5, 0x0152, 0x0153, 0x2013, 0x2014, 0x201C, 0x201D,
    0x2018, 0x2019, 0x00F7, 0x25CA, 0x00FF, 0x0178, 0x2044, 0x20AC, 0x2039, 0x203A, 0xFB01, 0xFB02,
    0x2021, 0x00B7, 0x201A, 0x201E, 0x2030, 0x00C2, 0x00CA, 0x00C1, 0x00CB, 0x00C8, 0x00CD, 0x00CE,
    0x00CF, 0x00CC, 0x00D3, 0x00D4, 0xF8FF, 0x00D2, 0x00DA, 0x00DB, 0x00D9, 0x0131, 0x02C6, 0x02DC,
    0x00AF, 0x02D8, 0x02D9, 0x02DA, 0x00B8, 0x02DD, 0x02DB, 0x02C7,
];

fn high_table(code_page: CharCodePage) -> &'static [u32; 128] {
    match code_page {
        CharCodePage::Windows1252 => &WINDOWS_1252_HIGH,
        CharCodePage::Macintosh => &MACINTOSH_ROMAN_HIGH,
    }
}

fn decode_byte(code_page: CharCodePage, code: u8) -> char {
    let scalar = if code < 0x80 {
        code as u32
    } else {
        high_table(code_page)[(code - 0x80) as usize]
    };
    // Both static tables contain valid Unicode scalar values.
    char::from_u32(scalar).expect("CHAR code-page table contains valid Unicode")
}

/// Encode one Unicode scalar for CODE.
///
/// Exact mappings are used. A scalar absent from a supported code page uses
/// the question-mark default byte (`0x3F`) under this product contract. This
/// is verified by the Windows-1252 Apple-logo golden (`CODE("") = 63`), but
/// it must not be read as a claim that every Windows conversion or every
/// Excel build uses a strict reverse map. Windows' `WideCharToMultiByte`
/// conversion has published best-fit tables for some code pages (for example,
/// fullwidth `Ａ` can map to `A`); Microsoft's public Excel `CODE` contract
/// does not specify whether that fallback is used. The selected page is a
/// typed enum, so unsupported page IDs cannot enter this function.
fn encode_char(code_page: CharCodePage, character: char) -> u8 {
    let table = high_table(code_page);
    if (character as u32) < 0x80 {
        return character as u8;
    }
    table
        .iter()
        .position(|&scalar| scalar == character as u32)
        .map(|index| index as u8 + 0x80)
        .unwrap_or(b'?')
}

pub(super) struct FnChar;
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                // Excel truncates numeric arguments before applying its
                // 1..255 CHAR range check.
                let code = n as u32;
                if !(1..=255).contains(&code) {
                    CellValue::error_with_message(
                        CellError::Value,
                        format!("CHAR: code {code} out of range, must be 1-255"),
                    )
                } else {
                    CellValue::Text(
                        decode_byte(context.char_code_page, code as u8)
                            .to_string()
                            .into(),
                    )
                }
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCode;
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
        self.call_with_context(args, &FunctionContext::default())
    }
    fn call_with_context(&self, args: &[CellValue], context: &FunctionContext) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_string() {
            Ok(s) if s.is_empty() => {
                CellValue::error_with_message(CellError::Value, "CODE: text must not be empty")
            }
            Ok(s) => {
                let character = match s.chars().next() {
                    Some(character) => character,
                    None => return CellValue::Error(CellError::Value, None),
                };
                CellValue::number(encode_char(context.char_code_page, character) as f64)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnChar));
    registry.register(Box::new(FnCode));
}
