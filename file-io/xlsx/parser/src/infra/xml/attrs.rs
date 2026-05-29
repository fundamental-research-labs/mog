use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::pipeline::fast_parse;

use super::decode::decode_xml_entities;

#[inline]
pub fn parse_bool_attr(xml: &[u8], attr: &[u8]) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if start < end {
                let first_byte = xml[start];
                return first_byte == b'1' || first_byte == b't' || first_byte == b'T';
            }
        }
    }
    false
}

#[inline]
pub fn parse_bool_attr_opt(xml: &[u8], attr: &[u8]) -> Option<bool> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let first_byte = xml[value_start];
    Some(first_byte == b'1' || first_byte == b't' || first_byte == b'T')
}

#[inline]
pub fn parse_bool_attr_with_default(xml: &[u8], attr: &[u8], default: bool) -> bool {
    if let Some(attr_pos) = find_attr_simd(xml, attr, 0) {
        let value_start = attr_pos + attr.len();
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            if start < end {
                let first_byte = xml[start];
                return first_byte == b'1' || first_byte == b't' || first_byte == b'T';
            }
        }
        return false;
    }
    default
}

#[inline]
pub fn parse_u32_attr(xml: &[u8], attr: &[u8]) -> Option<u32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let mut result: u32 = 0;
    let mut pos = value_start;

    while pos < xml.len() && xml[pos].is_ascii_digit() {
        result = result
            .saturating_mul(10)
            .saturating_add((xml[pos] - b'0') as u32);
        pos += 1;
    }

    if pos > value_start {
        Some(result)
    } else {
        None
    }
}

#[inline]
pub fn parse_u8_attr(xml: &[u8], attr: &[u8]) -> Option<u8> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let mut result: u8 = 0;
    let mut pos = value_start;

    while pos < xml.len() && xml[pos].is_ascii_digit() {
        result = result.saturating_mul(10).saturating_add(xml[pos] - b'0');
        pos += 1;
    }

    if pos > value_start {
        Some(result)
    } else {
        None
    }
}

#[inline]
pub fn parse_i32_attr(xml: &[u8], attr: &[u8]) -> Option<i32> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    let value_bytes = &xml[start..end];
    fast_parse::parse_i32_fast(value_bytes)
}

#[inline]
pub fn parse_f64_attr(xml: &[u8], attr: &[u8]) -> Option<f64> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;

    if start >= end {
        return None;
    }

    let value_bytes = &xml[start..end];
    fast_parse::parse_f64_fast(value_bytes)
}

#[inline]
pub fn parse_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_string_attr_quoted(xml, attr)
}

#[inline]
pub fn parse_string_attr_quoted(xml: &[u8], attr_name: &[u8]) -> Option<String> {
    let attr_name = normalize_attr_name(attr_name);
    if attr_name.is_empty() {
        return None;
    }

    let attr_pos = find_attr_name(xml, attr_name)?;
    let mut pos = attr_pos + attr_name.len();

    while pos < xml.len() && matches!(xml[pos], b' ' | b'\t' | b'\n' | b'\r') {
        pos += 1;
    }

    if pos >= xml.len() || xml[pos] != b'=' {
        return None;
    }
    pos += 1;

    while pos < xml.len() && matches!(xml[pos], b' ' | b'\t' | b'\n' | b'\r') {
        pos += 1;
    }

    let quote = *xml.get(pos)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }

    let value_start = pos + 1;
    if let Some(value_len) = memchr::memchr(quote, &xml[value_start..]) {
        Some(decode_xml_entities(
            &xml[value_start..value_start + value_len],
        ))
    } else if value_start < xml.len() {
        Some(decode_xml_entities(&xml[value_start..]))
    } else {
        None
    }
}

#[inline]
fn normalize_attr_name(attr_name: &[u8]) -> &[u8] {
    if attr_name.ends_with(b"=\"") || attr_name.ends_with(b"='") {
        &attr_name[..attr_name.len() - 2]
    } else if attr_name.ends_with(b"=") {
        &attr_name[..attr_name.len() - 1]
    } else {
        attr_name
    }
}

#[inline]
fn find_attr_name(xml: &[u8], attr_name: &[u8]) -> Option<usize> {
    let first = attr_name[0];
    let mut pos = 0;
    let mut active_quote: Option<u8> = None;

    while pos < xml.len() {
        let b = xml[pos];
        if let Some(quote) = active_quote {
            if b == quote {
                active_quote = None;
            }
            pos += 1;
            continue;
        }

        if b == b'"' || b == b'\'' {
            active_quote = Some(b);
            pos += 1;
            continue;
        }

        let end = pos + attr_name.len();

        if b == first
            && end <= xml.len()
            && &xml[pos..end] == attr_name
            && (pos == 0 || matches!(xml[pos - 1], b' ' | b'\t' | b'\n' | b'\r'))
            && (end >= xml.len() || matches!(xml[end], b'=' | b' ' | b'\t' | b'\n' | b'\r'))
        {
            return Some(pos);
        }

        pos += 1;
    }

    None
}

pub fn parse_string_attr_single_quote(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_string_attr_quoted(xml, attr)
}

#[inline]
pub fn parse_string_attr_verbatim(xml: &[u8], attr: &[u8]) -> Option<String> {
    parse_bytes_attr(xml, attr)
        .and_then(|b| std::str::from_utf8(b).ok())
        .map(|s| s.to_string())
}

#[inline]
pub fn parse_bytes_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();

    if value_start >= xml.len() {
        return None;
    }

    let mut pos = value_start;
    while pos < xml.len() && xml[pos] != b'"' {
        pos += 1;
    }

    Some(&xml[value_start..pos])
}

#[inline]
pub fn parse_enum_attr<'a>(xml: &'a [u8], attr: &[u8]) -> Option<&'a [u8]> {
    parse_bytes_attr(xml, attr)
}

#[inline]
pub fn parse_element_content(xml: &[u8], tag_name: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, tag_name, 0)?;
    let content_start = find_gt_simd(xml, tag_start)? + 1;
    let content_end = find_closing_tag(xml, tag_name, content_start)?;

    if content_start < content_end {
        Some(decode_xml_entities(&xml[content_start..content_end]))
    } else {
        Some(String::new())
    }
}
