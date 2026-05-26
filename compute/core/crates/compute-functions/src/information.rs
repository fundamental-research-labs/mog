//! Information functions: ISERR, ISEVEN, ISODD, ISLOGICAL, ISNONTEXT,
//! ISBETWEEN, ISDATE, ISEMAIL, ISURL, ISREF, N, TYPE, ERROR.TYPE, INFO, SHEET, SHEETS
//!
//! Note: Some IS* functions (ISERROR, ISNA, ISBLANK, ISNUMBER, ISTEXT)
//! are already implemented in logical.rs. This module implements the
//! remaining information functions.

use compute_formats::{CultureInfo, parse_date_input};
use value_types::date_serial;
use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

const MAX_SPREADSHEET_DATE_SERIAL: f64 = 2_958_465.0;
const ACCEPTED_URL_SCHEMES: &[&str] = &[
    "aim", "ftp", "gopher", "http", "https", "mailto", "news", "telnet",
];

fn coerce_between_number(value: &CellValue) -> Result<f64, CellValue> {
    value.coerce_to_number().map_err(|e| {
        CellValue::error_with_message(e, "ISBETWEEN: could not convert argument to number")
    })
}

fn coerce_between_flag(value: &CellValue) -> Result<bool, CellValue> {
    value
        .coerce_to_bool()
        .map_err(|e| CellValue::error_with_message(e, "ISBETWEEN: inclusivity flag is invalid"))
}

fn is_valid_date_serial(serial: f64) -> bool {
    serial.is_finite() && serial >= 1.0 && serial.floor() <= MAX_SPREADSHEET_DATE_SERIAL
}

fn is_valid_date_value(value: &CellValue) -> bool {
    match value {
        CellValue::Number(n) => is_valid_date_serial(n.get()),
        CellValue::Text(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return false;
            }

            // Round 74 pure functions do not receive workbook locale yet, so
            // text dates use the same default culture as compute input parsing.
            parse_date_input(trimmed, &CultureInfo::default())
                .map(|parsed| is_valid_date_serial(parsed.serial))
                .unwrap_or_else(|| {
                    date_serial::try_parse_datetime(trimmed).is_ok_and(is_valid_date_serial)
                })
        }
        _ => false,
    }
}

fn has_ascii_space_or_control(text: &str) -> bool {
    text.bytes()
        .any(|b| b.is_ascii_whitespace() || b < 0x20 || b == 0x7f)
}

fn is_valid_email_local(local: &str) -> bool {
    if local.is_empty()
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || has_ascii_space_or_control(local)
    {
        return false;
    }

    local.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'!' | b'#'
                    | b'$'
                    | b'%'
                    | b'&'
                    | b'\''
                    | b'*'
                    | b'+'
                    | b'-'
                    | b'/'
                    | b'='
                    | b'?'
                    | b'^'
                    | b'_'
                    | b'`'
                    | b'{'
                    | b'|'
                    | b'}'
                    | b'~'
                    | b'.'
            )
    })
}

fn is_plausible_tld(tld: &str) -> bool {
    (2..=24).contains(&tld.len()) && tld.bytes().all(|b| b.is_ascii_alphabetic())
}

fn is_valid_domain_label(label: &str) -> bool {
    !label.is_empty()
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn is_valid_domain_shape(domain: &str) -> bool {
    if domain.is_empty()
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
        || has_ascii_space_or_control(domain)
    {
        return false;
    }

    let mut labels = domain.split('.');
    let Some(first) = labels.next() else {
        return false;
    };
    if !is_valid_domain_label(first) {
        return false;
    }

    let mut label_count = 1;
    let mut last = first;
    for label in labels {
        label_count += 1;
        last = label;
        if !is_valid_domain_label(label) {
            return false;
        }
    }

    label_count >= 2 && is_plausible_tld(last)
}

fn is_email_shape(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed != text || has_ascii_space_or_control(trimmed) {
        return false;
    }

    let mut parts = trimmed.split('@');
    let Some(local) = parts.next() else {
        return false;
    };
    let Some(domain) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }

    is_valid_email_local(local) && is_valid_domain_shape(domain)
}

fn strip_port(host: &str) -> Option<&str> {
    let (base, port) = host.rsplit_once(':')?;
    if base.is_empty() || port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let parsed = port.parse::<u16>().ok()?;
    if parsed == 0 {
        return None;
    }
    Some(base)
}

fn is_valid_url_host(host: &str) -> bool {
    if host.starts_with('[') || host.ends_with(']') {
        return false;
    }
    let host = strip_port(host).unwrap_or(host);
    is_valid_domain_shape(host)
}

fn split_url_authority_and_tail(text: &str) -> (&str, &str) {
    let end = text.find(['/', '?', '#']).unwrap_or(text.len());
    (&text[..end], &text[end..])
}

fn tail_has_valid_url_chars(tail: &str) -> bool {
    !has_ascii_space_or_control(tail)
}

fn is_url_shape(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed != text || trimmed.is_empty() || has_ascii_space_or_control(trimmed) {
        return false;
    }

    if let Some(colon_idx) = trimmed.find(':') {
        let scheme_candidate = &trimmed[..colon_idx];
        if !scheme_candidate.is_empty() && scheme_candidate.bytes().all(|b| b.is_ascii_alphabetic())
        {
            let scheme = scheme_candidate.to_ascii_lowercase();
            if !ACCEPTED_URL_SCHEMES.contains(&scheme.as_str()) {
                return false;
            }

            let rest = &trimmed[colon_idx + 1..];
            if scheme == "mailto" {
                let address = rest.split(['?', '#']).next().unwrap_or("");
                return is_email_shape(address) && tail_has_valid_url_chars(&rest[address.len()..]);
            }

            if let Some(authority_rest) = rest.strip_prefix("//") {
                let (host, tail) = split_url_authority_and_tail(authority_rest);
                return is_valid_url_host(host) && tail_has_valid_url_chars(tail);
            }

            if matches!(scheme.as_str(), "news" | "aim") {
                let (host, tail) = split_url_authority_and_tail(rest);
                return is_valid_url_host(host) && tail_has_valid_url_chars(tail);
            }

            return false;
        }
    }

    let (host, tail) = split_url_authority_and_tail(trimmed);
    is_valid_url_host(host) && tail_has_valid_url_chars(tail)
}

fn isdate_single(value: &CellValue) -> CellValue {
    CellValue::Boolean(is_valid_date_value(value))
}

fn isemail_single(value: &CellValue) -> CellValue {
    CellValue::Boolean(match value {
        CellValue::Text(text) => is_email_shape(text),
        _ => false,
    })
}

fn isurl_single(value: &CellValue) -> CellValue {
    CellValue::Boolean(match value {
        CellValue::Text(text) => is_url_shape(text),
        _ => false,
    })
}

// ---------------------------------------------------------------------------
// ISBETWEEN — TRUE when a value is inside explicit numeric bounds
// ---------------------------------------------------------------------------

pub struct FnIsBetween;
impl PureFunction for FnIsBetween {
    fn name(&self) -> &'static str {
        "ISBETWEEN"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 | 4 => Some(CellValue::Boolean(true)),
            _ => None,
        }
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let value = match coerce_between_number(&args[0]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let lower = match coerce_between_number(&args[1]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let upper = match coerce_between_number(&args[2]) {
            Ok(value) => value,
            Err(error) => return error,
        };
        let lower_inclusive = match args.get(3) {
            Some(value) => match coerce_between_flag(value) {
                Ok(flag) => flag,
                Err(error) => return error,
            },
            None => true,
        };
        let upper_inclusive = match args.get(4) {
            Some(value) => match coerce_between_flag(value) {
                Ok(flag) => flag,
                Err(error) => return error,
            },
            None => true,
        };

        let lower_ok = if lower_inclusive {
            value >= lower
        } else {
            value > lower
        };
        let upper_ok = if upper_inclusive {
            value <= upper
        } else {
            value < upper
        };
        CellValue::Boolean(lower_ok && upper_ok)
    }
}

// ---------------------------------------------------------------------------
// ISDATE — TRUE if the value is a valid spreadsheet date serial or date text
// ---------------------------------------------------------------------------

pub struct FnIsDate;
impl PureFunction for FnIsDate {
    fn name(&self) -> &'static str {
        "ISDATE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isdate_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isdate_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISEMAIL — TRUE if text follows the formula-owned email shape
// ---------------------------------------------------------------------------

pub struct FnIsEmail;
impl PureFunction for FnIsEmail {
    fn name(&self) -> &'static str {
        "ISEMAIL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isemail_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isemail_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISURL — TRUE if text follows the formula-owned URL shape
// ---------------------------------------------------------------------------

pub struct FnIsUrl;
impl PureFunction for FnIsUrl {
    fn name(&self) -> &'static str {
        "ISURL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isurl_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isurl_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISERR — TRUE for any error EXCEPT #N/A
// ---------------------------------------------------------------------------

fn iserr_single(val: &CellValue) -> CellValue {
    match val {
        CellValue::Error(e, _) => CellValue::Boolean(*e != CellError::Na),
        _ => CellValue::Boolean(false),
    }
}

pub struct FnIsErr;
impl PureFunction for FnIsErr {
    fn name(&self) -> &'static str {
        "ISERR"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(iserr_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => iserr_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISEVEN — TRUE if truncated number is even
// ---------------------------------------------------------------------------

pub struct FnIsEven;
impl PureFunction for FnIsEven {
    fn name(&self) -> &'static str {
        "ISEVEN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Propagate errors
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        // Excel returns #VALUE! for boolean inputs to ISEVEN
        if matches!(&args[0], CellValue::Boolean(_)) {
            return CellValue::error_with_message(
                CellError::Value,
                "ISEVEN: boolean argument is not allowed",
            );
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let int_val = n.trunc() as i64;
                CellValue::Boolean(int_val % 2 == 0)
            }
            Err(e) => CellValue::error_with_message(e, "ISEVEN: could not convert to number"),
        }
    }
}

// ---------------------------------------------------------------------------
// ISODD — TRUE if truncated number is odd
// ---------------------------------------------------------------------------

pub struct FnIsOdd;
impl PureFunction for FnIsOdd {
    fn name(&self) -> &'static str {
        "ISODD"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Propagate errors
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        // Excel returns #VALUE! for boolean inputs to ISODD
        if matches!(&args[0], CellValue::Boolean(_)) {
            return CellValue::error_with_message(
                CellError::Value,
                "ISODD: boolean argument is not allowed",
            );
        }
        match args[0].coerce_to_number() {
            Ok(n) => {
                let int_val = n.trunc() as i64;
                CellValue::Boolean(int_val % 2 != 0)
            }
            Err(e) => CellValue::error_with_message(e, "ISODD: could not convert to number"),
        }
    }
}

// ---------------------------------------------------------------------------
// ISLOGICAL — TRUE if value is boolean
// ---------------------------------------------------------------------------

fn islogical_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(matches!(val, CellValue::Boolean(_)))
}

pub struct FnIsLogical;
impl PureFunction for FnIsLogical {
    fn name(&self) -> &'static str {
        "ISLOGICAL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(islogical_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => islogical_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISNONTEXT — TRUE if value is NOT text (opposite of ISTEXT)
// ---------------------------------------------------------------------------

fn isnontext_single(val: &CellValue) -> CellValue {
    CellValue::Boolean(!matches!(val, CellValue::Text(_)))
}

pub struct FnIsNonText;
impl PureFunction for FnIsNonText {
    fn name(&self) -> &'static str {
        "ISNONTEXT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(isnontext_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => isnontext_single(&args[0]),
        }
    }
}

// ---------------------------------------------------------------------------
// ISREF — TRUE if argument is a reference
// In our architecture, references are resolved before function calls,
// so we return TRUE for all non-error values as a pragmatic solution.
// ---------------------------------------------------------------------------

pub struct FnIsRef;
impl PureFunction for FnIsRef {
    fn name(&self) -> &'static str {
        "ISREF"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // ISREF never propagates errors — errors are "not references"
        CellValue::Boolean(!args[0].is_error())
    }
}

// ---------------------------------------------------------------------------
// ISFORMULA — TRUE if cell contains a formula
// Needs EvaluationContext to determine if a cell has a formula.
// Stub implementation returning FALSE for now.
// ---------------------------------------------------------------------------
// N — converts value to number
// Number=number, TRUE=1, FALSE=0, error=error, everything else=0
// ---------------------------------------------------------------------------

pub struct FnN;
impl PureFunction for FnN {
    fn name(&self) -> &'static str {
        "N"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Number(n) => CellValue::Number(*n),
            CellValue::Boolean(b) => CellValue::number(if *b { 1.0 } else { 0.0 }),
            CellValue::Error(e, _) => CellValue::Error(*e, None),
            _ => CellValue::number(0.0), // Text, Null, Array => 0
        }
    }
}

// ---------------------------------------------------------------------------
// TYPE — returns type number
// 1=number, 2=text, 4=boolean, 16=error, 64=array
// Null is treated as number (returns 1) per Excel behavior.
// ---------------------------------------------------------------------------

pub struct FnType;
impl PureFunction for FnType {
    fn name(&self) -> &'static str {
        "TYPE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let type_num = match &args[0] {
            CellValue::Number(_) => 1.0,
            CellValue::Text(_) => 2.0,
            CellValue::Boolean(_) | CellValue::Control(_) => 4.0,
            CellValue::Error(..) => 16.0,
            CellValue::Array(_) => 64.0,
            CellValue::Null => 1.0, // Excel treats blank as number
        };
        CellValue::number(type_num)
    }
}

// ---------------------------------------------------------------------------
// ERROR.TYPE — returns error number
// 1=#NULL!, 2=#DIV/0!, 3=#VALUE!, 4=#REF!, 5=#NAME?, 6=#NUM!, 7=#N/A, 8=#GETTING_DATA
// Returns #N/A if value is not an error.
// ---------------------------------------------------------------------------

pub struct FnErrorType;
impl PureFunction for FnErrorType {
    fn name(&self) -> &'static str {
        "ERROR.TYPE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Error(e, _) => {
                let n = match e {
                    CellError::Null => 1.0,
                    CellError::Div0 => 2.0,
                    CellError::Value => 3.0,
                    CellError::Ref => 4.0,
                    CellError::Name => 5.0,
                    CellError::Num => 6.0,
                    CellError::Na => 7.0,
                    CellError::GettingData => 8.0,
                    // Spill, Calc, and Circ are newer/internal errors not in the classic ERROR.TYPE list
                    CellError::Spill | CellError::Calc | CellError::Circ => {
                        return CellValue::error_with_message(
                            CellError::Na,
                            "ERROR.TYPE: unrecognized error variant",
                        );
                    }
                };
                CellValue::number(n)
            }
            _ => CellValue::error_with_message(
                CellError::Na,
                "ERROR.TYPE: argument is not an error value",
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// CELL — returns information about a cell
// Basic implementation supporting: "type", "contents"
// "row", "col", "address" are handled in eval_primitives (need AST access).
// Returns #N/A for unsupported info types.
// ---------------------------------------------------------------------------

pub struct FnCell;
impl PureFunction for FnCell {
    fn name(&self) -> &'static str {
        "CELL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // First arg is info_type string (already validated by eval_primitives caller)
        let info_str = match &args[0] {
            CellValue::Text(s) => s.to_lowercase(),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "CELL: first argument must be a text info_type",
                );
            }
        };

        let reference_value = if args.len() > 1 {
            &args[1]
        } else {
            &CellValue::Null
        };

        match info_str.as_str() {
            "type" => {
                // Excel CELL("type") returns:
                //   "b" for blank, "l" for text (label), "v" for everything else (value)
                match reference_value {
                    CellValue::Null => CellValue::Text("b".to_string().into()),
                    CellValue::Text(_) => CellValue::Text("l".to_string().into()),
                    _ => CellValue::Text("v".to_string().into()), // numbers, booleans, errors
                }
            }
            "contents" => {
                // Return the cell's value directly (errors propagate)
                reference_value.clone()
            }
            // "row", "col", "address" are handled in eval_primitives before reaching here
            _ => CellValue::error_with_message(
                CellError::Na,
                format!("CELL: unsupported info_type \"{}\"", info_str),
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// INFO — returns system information
// Basic implementation for compute engine environment.
// ---------------------------------------------------------------------------

pub struct FnInfo;
impl PureFunction for FnInfo {
    fn name(&self) -> &'static str {
        "INFO"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        let info_type = match args[0].coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(e) => {
                return CellValue::error_with_message(
                    e,
                    "INFO: could not convert argument to text",
                );
            }
        };

        match info_type.as_str() {
            "directory" => CellValue::Text("/".to_string().into()),
            "numfile" => CellValue::number(1.0),
            "origin" => CellValue::Text("$A$1".to_string().into()),
            "osversion" => CellValue::Text("Shortcut".to_string().into()),
            "recalc" => CellValue::Text("Automatic".to_string().into()),
            "release" => CellValue::Text("16.0".to_string().into()),
            "system" => CellValue::Text("pcdos".to_string().into()),
            _ => CellValue::error_with_message(
                CellError::Na,
                format!("INFO: unsupported info_type \"{}\"", info_type),
            ),
        }
    }
}

// ---------------------------------------------------------------------------
// SHEET — returns the sheet number of a reference
// Stub: always returns 1.
// ---------------------------------------------------------------------------

pub struct FnSheet;
impl PureFunction for FnSheet {
    fn name(&self) -> &'static str {
        "SHEET"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Propagate errors from argument
        if !args.is_empty()
            && let CellValue::Error(e, _) = &args[0]
        {
            return CellValue::Error(*e, None);
        }
        CellValue::number(1.0)
    }
}

// ---------------------------------------------------------------------------
// SHEETS — returns the number of sheets
// Stub: always returns 1.
// ---------------------------------------------------------------------------

pub struct FnSheets;
impl PureFunction for FnSheets {
    fn name(&self) -> &'static str {
        "SHEETS"
    }
    fn min_args(&self) -> usize {
        0
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // Propagate errors from argument
        if !args.is_empty()
            && let CellValue::Error(e, _) = &args[0]
        {
            return CellValue::Error(*e, None);
        }
        CellValue::number(1.0)
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsErr));
    registry.register(Box::new(FnIsEven));
    registry.register(Box::new(FnIsOdd));
    registry.register(Box::new(FnIsLogical));
    registry.register(Box::new(FnIsNonText));
    registry.register(Box::new(FnIsBetween));
    registry.register(Box::new(FnIsDate));
    registry.register(Box::new(FnIsEmail));
    registry.register(Box::new(FnIsUrl));
    registry.register(Box::new(FnIsRef));
    registry.register(Box::new(FnN));
    registry.register(Box::new(FnType));
    registry.register(Box::new(FnErrorType));
    registry.register(Box::new(FnCell));
    registry.register(Box::new(FnInfo));
    registry.register(Box::new(FnSheet));
    registry.register(Box::new(FnSheets));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.to_string().into())
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn bool_val(b: bool) -> CellValue {
        CellValue::Boolean(b)
    }
    fn null() -> CellValue {
        CellValue::Null
    }
    fn array(rows: Vec<Vec<CellValue>>) -> CellValue {
        CellValue::from_rows(rows)
    }

    // --- ISERR ---

    #[test]
    fn test_iserr_div0() {
        assert_eq!(FnIsErr.call(&[err(CellError::Div0)]), bool_val(true));
    }

    #[test]
    fn test_iserr_na_excluded() {
        // ISERR returns FALSE for #N/A
        assert_eq!(FnIsErr.call(&[err(CellError::Na)]), bool_val(false));
    }

    #[test]
    fn test_iserr_not_error() {
        assert_eq!(FnIsErr.call(&[num(5.0)]), bool_val(false));
        assert_eq!(FnIsErr.call(&[text("hello")]), bool_val(false));
    }

    // --- ISEVEN / ISODD ---

    #[test]
    fn test_iseven() {
        assert_eq!(FnIsEven.call(&[num(4.0)]), bool_val(true));
        assert_eq!(FnIsEven.call(&[num(3.0)]), bool_val(false));
        assert_eq!(FnIsEven.call(&[num(0.0)]), bool_val(true));
        assert_eq!(FnIsEven.call(&[num(-4.0)]), bool_val(true));
    }

    #[test]
    fn test_iseven_truncates() {
        assert_eq!(FnIsEven.call(&[num(4.7)]), bool_val(true));
        assert_eq!(FnIsEven.call(&[num(3.9)]), bool_val(false));
    }

    #[test]
    fn test_iseven_boolean_error() {
        assert_eq!(FnIsEven.call(&[bool_val(true)]), err(CellError::Value));
    }

    #[test]
    fn test_iseven_error_propagation() {
        assert_eq!(FnIsEven.call(&[err(CellError::Ref)]), err(CellError::Ref));
    }

    #[test]
    fn test_isodd() {
        assert_eq!(FnIsOdd.call(&[num(3.0)]), bool_val(true));
        assert_eq!(FnIsOdd.call(&[num(4.0)]), bool_val(false));
        assert_eq!(FnIsOdd.call(&[num(0.0)]), bool_val(false));
        assert_eq!(FnIsOdd.call(&[num(-3.0)]), bool_val(true));
    }

    #[test]
    fn test_isodd_truncates() {
        assert_eq!(FnIsOdd.call(&[num(3.2)]), bool_val(true));
        assert_eq!(FnIsOdd.call(&[num(4.8)]), bool_val(false));
    }

    #[test]
    fn test_isodd_boolean_error() {
        assert_eq!(FnIsOdd.call(&[bool_val(false)]), err(CellError::Value));
    }

    // --- ISLOGICAL ---

    #[test]
    fn test_islogical() {
        assert_eq!(FnIsLogical.call(&[bool_val(true)]), bool_val(true));
        assert_eq!(FnIsLogical.call(&[bool_val(false)]), bool_val(true));
        assert_eq!(FnIsLogical.call(&[num(1.0)]), bool_val(false));
        assert_eq!(FnIsLogical.call(&[text("TRUE")]), bool_val(false));
        assert_eq!(FnIsLogical.call(&[err(CellError::Na)]), bool_val(false));
    }

    // --- ISNONTEXT ---

    #[test]
    fn test_isnontext() {
        assert_eq!(FnIsNonText.call(&[num(1.0)]), bool_val(true));
        assert_eq!(FnIsNonText.call(&[bool_val(true)]), bool_val(true));
        assert_eq!(FnIsNonText.call(&[null()]), bool_val(true));
        assert_eq!(FnIsNonText.call(&[err(CellError::Na)]), bool_val(true));
        assert_eq!(FnIsNonText.call(&[text("hello")]), bool_val(false));
        assert_eq!(FnIsNonText.call(&[text("")]), bool_val(false));
    }

    // --- ISBETWEEN ---

    #[test]
    fn test_isbetween_defaults_and_inclusive_bounds() {
        assert_eq!(
            FnIsBetween.call(&[num(5.0), num(1.0), num(10.0)]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[num(1.0), num(1.0), num(10.0)]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[num(10.0), num(1.0), num(10.0)]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[num(0.0), num(1.0), num(10.0)]),
            bool_val(false)
        );
    }

    #[test]
    fn test_isbetween_inclusivity_matrix_and_equal_bounds() {
        assert_eq!(
            FnIsBetween.call(&[num(1.0), num(1.0), num(10.0), bool_val(false)]),
            bool_val(false)
        );
        assert_eq!(
            FnIsBetween.call(&[
                num(10.0),
                num(1.0),
                num(10.0),
                bool_val(true),
                bool_val(false)
            ]),
            bool_val(false)
        );
        assert_eq!(
            FnIsBetween.call(&[num(5.0), num(5.0), num(5.0), bool_val(true), bool_val(true)]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[
                num(5.0),
                num(5.0),
                num(5.0),
                bool_val(false),
                bool_val(true)
            ]),
            bool_val(false)
        );
    }

    #[test]
    fn test_isbetween_reversed_bounds_and_coercions() {
        assert_eq!(
            FnIsBetween.call(&[num(5.0), num(10.0), num(1.0)]),
            bool_val(false)
        );
        assert_eq!(
            FnIsBetween.call(&[text("5"), text("1"), text("10")]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[bool_val(true), num(1.0), num(1.0)]),
            bool_val(true)
        );
        assert_eq!(
            FnIsBetween.call(&[text("x"), num(1.0), num(2.0)]),
            err(CellError::Value)
        );
        assert_eq!(
            FnIsBetween.call(&[err(CellError::Ref), num(1.0), num(2.0)]),
            err(CellError::Ref)
        );
    }

    #[test]
    fn test_isbetween_registry_array_broadcast() {
        let reg = FunctionRegistry::new();
        let values = array(vec![vec![num(0.0)], vec![num(5.0)], vec![num(10.0)]]);
        let result = reg.call("ISBETWEEN", &[values, num(1.0), num(10.0)]);
        assert_eq!(
            result,
            array(vec![
                vec![bool_val(false)],
                vec![bool_val(true)],
                vec![bool_val(true)]
            ])
        );

        let lower_bounds = array(vec![vec![num(0.0), num(6.0)]]);
        let result = reg.call("ISBETWEEN", &[num(5.0), lower_bounds, num(10.0)]);
        assert_eq!(result, array(vec![vec![bool_val(true), bool_val(false)]]));

        let incompatible = reg.call(
            "ISBETWEEN",
            &[
                array(vec![vec![num(1.0), num(2.0)], vec![num(3.0), num(4.0)]]),
                array(vec![vec![num(0.0)], vec![num(0.0)], vec![num(0.0)]]),
                num(10.0),
            ],
        );
        assert_eq!(incompatible, err(CellError::Value));
    }

    // --- ISDATE ---

    #[test]
    fn test_isdate_numbers() {
        assert_eq!(FnIsDate.call(&[num(1.0)]), bool_val(true));
        assert_eq!(FnIsDate.call(&[num(60.0)]), bool_val(true));
        assert_eq!(FnIsDate.call(&[num(61.0)]), bool_val(true));
        assert_eq!(FnIsDate.call(&[num(45_292.75)]), bool_val(true));
        assert_eq!(FnIsDate.call(&[num(0.0)]), bool_val(false));
        assert_eq!(FnIsDate.call(&[num(0.75)]), bool_val(false));
        assert_eq!(FnIsDate.call(&[num(-1.0)]), bool_val(false));
        assert_eq!(FnIsDate.call(&[num(2_958_466.0)]), bool_val(false));
    }

    #[test]
    fn test_isdate_text() {
        assert_eq!(FnIsDate.call(&[text("2024-03-15")]), bool_val(true));
        assert_eq!(FnIsDate.call(&[text("3/15/2024")]), bool_val(true));
        assert_eq!(FnIsDate.call(&[text("July 20 1969")]), bool_val(true));
        assert_eq!(FnIsDate.call(&[text("15-Jul-2024")]), bool_val(true));
        assert_eq!(
            FnIsDate.call(&[text("January 15, 2024 3:00 PM")]),
            bool_val(true)
        );
        assert_eq!(FnIsDate.call(&[text("")]), bool_val(false));
        assert_eq!(FnIsDate.call(&[text("July")]), bool_val(false));
        assert_eq!(FnIsDate.call(&[text("Feb 30")]), bool_val(false));
        assert_eq!(FnIsDate.call(&[text("13/32/2024")]), bool_val(false));
        assert_eq!(FnIsDate.call(&[text("12:30 PM")]), bool_val(false));
        assert_eq!(FnIsDate.call(&[text("12345")]), bool_val(false));
    }

    #[test]
    fn test_isdate_non_matches_and_arrays() {
        assert_eq!(FnIsDate.call(&[bool_val(true)]), bool_val(false));
        assert_eq!(FnIsDate.call(&[null()]), bool_val(false));
        assert_eq!(FnIsDate.call(&[err(CellError::Div0)]), bool_val(false));
        assert_eq!(
            FnIsDate.call(&[array(vec![vec![
                num(1.0),
                text("July"),
                err(CellError::Na)
            ]])]),
            array(vec![vec![bool_val(true), bool_val(false), bool_val(false)]])
        );
    }

    // --- ISEMAIL ---

    #[test]
    fn test_isemail_valid_shapes() {
        for value in [
            "noreply@google.com",
            "johndoe@yourname.com",
            "janesmith@yourname.xyz",
            "first.last+tag@example.co.uk",
            "a_b-c@example-domain.com",
        ] {
            assert_eq!(FnIsEmail.call(&[text(value)]), bool_val(true), "{value}");
        }
    }

    #[test]
    fn test_isemail_invalid_shapes() {
        for value in [
            "",
            "missing-domain@",
            "@missing-local.com",
            "a@@example.com",
            "a b@example.com",
            "a@example",
            "a@example..com",
            "a@-example.com",
            ".a@example.com",
            "a.@example.com",
            "a..b@example.com",
            "\"a\"@example.com",
            "Alice <a@example.com>",
            "a@[127.0.0.1]",
        ] {
            assert_eq!(FnIsEmail.call(&[text(value)]), bool_val(false), "{value}");
        }
    }

    #[test]
    fn test_isemail_non_text_and_arrays() {
        assert_eq!(FnIsEmail.call(&[num(1.0)]), bool_val(false));
        assert_eq!(FnIsEmail.call(&[bool_val(true)]), bool_val(false));
        assert_eq!(FnIsEmail.call(&[null()]), bool_val(false));
        assert_eq!(FnIsEmail.call(&[err(CellError::Value)]), bool_val(false));
        assert_eq!(
            FnIsEmail.call(&[array(vec![vec![text("a@example.com"), text("bad")]])]),
            array(vec![vec![bool_val(true), bool_val(false)]])
        );
    }

    // --- ISURL ---

    #[test]
    fn test_isurl_valid_shapes() {
        for value in [
            "https://example.com",
            "http://example.com/path?q=1#top",
            "ftp://files.example.org/pub",
            "gopher://example.com",
            "telnet://example.com:23",
            "news:example.com",
            "aim:example.com",
            "www.example.com",
            "google.com/search?q=sheets",
            "mailto:noreply@example.com",
        ] {
            assert_eq!(FnIsUrl.call(&[text(value)]), bool_val(true), "{value}");
        }
    }

    #[test]
    fn test_isurl_invalid_shapes() {
        for value in [
            "",
            "https://",
            "ssh://example.com",
            "http://example",
            "http://example..com",
            "http://-example.com",
            "http://example.invalid123",
            "example",
            "example.c",
            "http://127.0.0.1",
            "https://example.com/a b",
            " mailto:noreply@example.com",
            "mailto:not-email",
        ] {
            assert_eq!(FnIsUrl.call(&[text(value)]), bool_val(false), "{value}");
        }
    }

    #[test]
    fn test_isurl_non_text_and_arrays() {
        assert_eq!(FnIsUrl.call(&[num(1.0)]), bool_val(false));
        assert_eq!(FnIsUrl.call(&[bool_val(false)]), bool_val(false));
        assert_eq!(FnIsUrl.call(&[null()]), bool_val(false));
        assert_eq!(FnIsUrl.call(&[err(CellError::Name)]), bool_val(false));
        assert_eq!(
            FnIsUrl.call(&[array(vec![vec![text("example.com"), text("not url")]])]),
            array(vec![vec![bool_val(true), bool_val(false)]])
        );
    }

    // --- ISREF ---

    #[test]
    fn test_isref() {
        assert_eq!(FnIsRef.call(&[num(1.0)]), bool_val(true));
        assert_eq!(FnIsRef.call(&[text("A1")]), bool_val(true));
        assert_eq!(FnIsRef.call(&[null()]), bool_val(true));
        assert_eq!(FnIsRef.call(&[err(CellError::Ref)]), bool_val(false));
    }

    // --- N ---

    #[test]
    fn test_n_number() {
        assert_eq!(FnN.call(&[num(42.0)]), num(42.0));
    }

    #[test]
    fn test_n_boolean() {
        assert_eq!(FnN.call(&[bool_val(true)]), num(1.0));
        assert_eq!(FnN.call(&[bool_val(false)]), num(0.0));
    }

    #[test]
    fn test_n_text() {
        assert_eq!(FnN.call(&[text("hello")]), num(0.0));
    }

    #[test]
    fn test_n_error() {
        assert_eq!(FnN.call(&[err(CellError::Div0)]), err(CellError::Div0));
    }

    #[test]
    fn test_n_null() {
        assert_eq!(FnN.call(&[null()]), num(0.0));
    }

    // --- TYPE ---

    #[test]
    fn test_type_number() {
        assert_eq!(FnType.call(&[num(1.0)]), num(1.0));
    }

    #[test]
    fn test_type_text() {
        assert_eq!(FnType.call(&[text("hello")]), num(2.0));
    }

    #[test]
    fn test_type_boolean() {
        assert_eq!(FnType.call(&[bool_val(true)]), num(4.0));
    }

    #[test]
    fn test_type_error() {
        assert_eq!(FnType.call(&[err(CellError::Na)]), num(16.0));
    }

    #[test]
    fn test_type_array() {
        let arr = CellValue::from_rows(vec![vec![num(1.0)]]);
        assert_eq!(FnType.call(&[arr]), num(64.0));
    }

    #[test]
    fn test_type_null() {
        assert_eq!(FnType.call(&[null()]), num(1.0));
    }

    // --- ERROR.TYPE ---

    #[test]
    fn test_error_type_null() {
        assert_eq!(FnErrorType.call(&[err(CellError::Null)]), num(1.0));
    }

    #[test]
    fn test_error_type_div0() {
        assert_eq!(FnErrorType.call(&[err(CellError::Div0)]), num(2.0));
    }

    #[test]
    fn test_error_type_value() {
        assert_eq!(FnErrorType.call(&[err(CellError::Value)]), num(3.0));
    }

    #[test]
    fn test_error_type_ref() {
        assert_eq!(FnErrorType.call(&[err(CellError::Ref)]), num(4.0));
    }

    #[test]
    fn test_error_type_name() {
        assert_eq!(FnErrorType.call(&[err(CellError::Name)]), num(5.0));
    }

    #[test]
    fn test_error_type_num() {
        assert_eq!(FnErrorType.call(&[err(CellError::Num)]), num(6.0));
    }

    #[test]
    fn test_error_type_na() {
        assert_eq!(FnErrorType.call(&[err(CellError::Na)]), num(7.0));
    }

    #[test]
    fn test_error_type_getting_data() {
        assert_eq!(FnErrorType.call(&[err(CellError::GettingData)]), num(8.0));
    }

    #[test]
    fn test_error_type_not_error() {
        assert_eq!(FnErrorType.call(&[num(1.0)]), err(CellError::Na));
        assert_eq!(FnErrorType.call(&[text("hello")]), err(CellError::Na));
    }

    // --- INFO ---

    #[test]
    fn test_info_osversion() {
        assert_eq!(FnInfo.call(&[text("osversion")]), text("Shortcut"));
    }

    #[test]
    fn test_info_recalc() {
        assert_eq!(FnInfo.call(&[text("recalc")]), text("Automatic"));
    }

    #[test]
    fn test_info_system() {
        assert_eq!(FnInfo.call(&[text("system")]), text("pcdos"));
    }

    #[test]
    fn test_info_unsupported() {
        assert_eq!(FnInfo.call(&[text("unknown")]), err(CellError::Na));
    }

    // --- SHEET / SHEETS ---

    #[test]
    fn test_sheet_no_args() {
        assert_eq!(FnSheet.call(&[]), num(1.0));
    }

    #[test]
    fn test_sheet_with_arg() {
        assert_eq!(FnSheet.call(&[text("Sheet1")]), num(1.0));
    }

    #[test]
    fn test_sheet_error_propagation() {
        assert_eq!(FnSheet.call(&[err(CellError::Ref)]), err(CellError::Ref));
    }

    #[test]
    fn test_sheets_no_args() {
        assert_eq!(FnSheets.call(&[]), num(1.0));
    }

    #[test]
    fn test_sheets_with_arg() {
        assert_eq!(FnSheets.call(&[num(1.0)]), num(1.0));
    }

    #[test]
    fn test_sheets_error_propagation() {
        assert_eq!(FnSheets.call(&[err(CellError::Na)]), err(CellError::Na));
    }

    // --- Bulk IS* function array tests ---

    #[test]
    fn test_islogical_array() {
        let arr = CellValue::from_rows(vec![vec![bool_val(true), num(1.0), bool_val(false)]]);
        let result = FnIsLogical.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_isnontext_array() {
        let arr = CellValue::from_rows(vec![vec![num(1.0), text("hi"), bool_val(true)]]);
        let result = FnIsNonText.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_iserr_array() {
        let arr = CellValue::from_rows(vec![vec![
            err(CellError::Div0),
            err(CellError::Na),
            num(1.0),
        ]]);
        let result = FnIsErr.call(&[arr]);
        match result {
            CellValue::Array(rows) => {
                // ISERR returns TRUE for all errors EXCEPT #N/A
                assert_eq!(*rows.get(0, 0).unwrap(), bool_val(true));
                assert_eq!(*rows.get(0, 1).unwrap(), bool_val(false));
                assert_eq!(*rows.get(0, 2).unwrap(), bool_val(false));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }
}

// ---------------------------------------------------------------------------
// Function structs for registration (used by mod.rs):
// FnIsErr, FnIsEven, FnIsOdd, FnIsLogical, FnIsNonText, FnIsRef,
// FnN, FnType, FnErrorType, FnInfo, FnSheet, FnSheets
// ---------------------------------------------------------------------------
