use compute_formats::{CultureInfo, parse_date_input};
use value_types::CellValue;
use value_types::date_serial;

use crate::{FunctionRegistry, PureFunction};

const MAX_SPREADSHEET_DATE_SERIAL: f64 = 2_958_465.0;
const ACCEPTED_URL_SCHEMES: &[&str] = &[
    "aim", "ftp", "gopher", "http", "https", "mailto", "news", "telnet",
];

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

            // Pure functions do not receive workbook locale today, so text dates
            // use the same default culture as compute input parsing.
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

pub(super) struct FnIsDate;

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

pub(super) struct FnIsEmail;

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

pub(super) struct FnIsUrl;

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

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnIsDate));
    registry.register(Box::new(FnIsEmail));
    registry.register(Box::new(FnIsUrl));
}
