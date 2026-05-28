use super::super::super::types::{TextAlign, TextAnchor, TextWrap};

pub fn parse_text_anchor(bytes: &[u8]) -> Option<TextAnchor> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextAnchor::from_ooxml(s);
    // from_ooxml defaults to Top for unknown inputs; we return None instead.
    if parsed != TextAnchor::Top || s == "t" {
        Some(parsed)
    } else {
        None
    }
}

/// Parse text wrap, delegating to `TextWrap::from_ooxml()`.
pub fn parse_text_wrap(bytes: &[u8]) -> Option<TextWrap> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextWrap::from_ooxml(s);
    // from_ooxml defaults to None for unknown inputs; distinguish from valid "none".
    if s == "none" || s == "square" {
        Some(parsed)
    } else {
        None
    }
}

/// Parse text alignment, delegating to `TextAlign::from_ooxml()`.
pub fn parse_text_align(bytes: &[u8]) -> Option<TextAlign> {
    let s = std::str::from_utf8(bytes).ok()?;
    let parsed = TextAlign::from_ooxml(s);
    // from_ooxml defaults to Left for unknown inputs; we return None instead.
    if parsed != TextAlign::Left || s == "l" {
        Some(parsed)
    } else {
        None
    }
}
